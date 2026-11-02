'use strict';
/*
 * One fixed pool: deposit (V7 only), and withdraw with a proof bound to recipient, relayer and fee (V7/V6) or to the
 * recipient (V5, withdrawals of existing notes only).
 */
const { Contract, ZeroAddress, getAddress } = require('ethers');
const { POOL_ABI, VERIFIER_ABI, ERC20_ABI, ROOT_HISTORY } = require('./constants');
const { assertDepositable } = require('./deployments');
const { computeNullifierHash, computeCommitment } = require('./poseidon');
const { generateNote, decodeNote } = require('./notes');
const { getProofInputsForCommitment } = require('./merkleTree');
const { loadCircuit, buildWithdrawInput, proveWithdraw } = require('./prove');
const { relayWithdraw, hasRelayer } = require('./relayer');

const ROOT_RETRIES = 3;   // proofs name a root the pool may forget (ROOT_HISTORY newer deposits); re-prove that many times

const isSigner = (x) => !!(x && typeof x.sendTransaction === 'function' && typeof x.getAddress === 'function');
const providerOf = (x) => (isSigner(x) ? x.provider : x);
const poolContract = (pool, runner) => new Contract(pool.address, POOL_ABI[pool.version], runner);

/** A deposit's gas depends on which tree slots it writes; send with 30 % over the estimate (only the gas used is paid). */
async function sendWithGasMargin(contract, method, args, overrides = {}) {
  const est = await contract[method].estimateGas(...args, overrides);
  return contract[method](...args, Object.assign({}, overrides, { gasLimit: est * 13n / 10n }));
}
/** Fee caps for a transaction sent after proving: twice the latest base fee plus the tip, so a base fee that rose meanwhile does not get it refused. */
async function feeOverrides(provider) {
  try { const fd = await provider.getFeeData(); return fd.maxFeePerGas ? { maxFeePerGas: fd.maxFeePerGas, maxPriorityFeePerGas: fd.maxPriorityFeePerGas } : {}; }
  catch (e) { return {}; }
}

/**
 * Deposits one note of `pool.denomination` into a V7 pool. Refuses every pre-V7 or flagged pool.
 * Native pools take the coin as msg.value; an ERC-20 pool gets an approve first.
 * @returns {Promise<{note: string, spendKey: bigint, viewKey: bigint, commitment: bigint, leafIndex: number, txHash: string, receipt: object}>}
 */
async function deposit(signer, pool, opts = {}) {
  assertDepositable(pool);
  if (!isSigner(signer)) throw new Error('deposit needs an ethers Signer');
  const n = generateNote(pool, opts);
  const contract = poolContract(pool, signer);
  const overrides = {};
  if (pool.native) overrides.value = pool.denomination;
  else {
    const token = new Contract(pool.tok.address, ERC20_ABI, signer);
    const owner = await signer.getAddress();
    if ((await token.allowance(owner, pool.address)) < pool.denomination) await (await token.approve(pool.address, pool.denomination)).wait();
  }
  const tx = await sendWithGasMargin(contract, 'deposit', [n.commitment], overrides);
  const receipt = await tx.wait();
  const ev = receipt.logs.map((l) => { try { return contract.interface.parseLog(l); } catch (e) { return null; } }).find((e) => e && e.name === 'Deposit');
  return Object.assign(n, { leafIndex: ev ? Number(ev.args.leafIndex) : null, txHash: receipt.hash, receipt });
}

/** True when the note (by spendKey, by nullifier hash, or a decoded note) is already spent in `pool`. */
async function isSpent(provider, pool, keyOrNote) {
  let nh;
  if (keyOrNote && typeof keyOrNote === 'object') {
    if (keyOrNote.nullifierHash !== undefined) nh = BigInt(keyOrNote.nullifierHash);
    else if (keyOrNote.spendKey !== undefined) nh = computeNullifierHash(keyOrNote.spendKey);
    else throw new Error('isSpent: pass a note, a spendKey or { nullifierHash }');
  } else nh = computeNullifierHash(keyOrNote);
  return poolContract(pool, providerOf(provider)).nullifierHashes(nh);
}
/** True when the pool still remembers `root` (one of its last ROOT_HISTORY roots). */
async function isKnownRoot(provider, pool, root) { return poolContract(pool, providerOf(provider)).isKnownRoot(root); }

/** Checks a proof against the pool's verifier contract (a view call; what the pool itself does). */
async function verifyOnChain(provider, pool, proof) {
  if (!pool.verifierAddr) throw new Error('Pool has no verifier address');
  return new Contract(pool.verifierAddr, VERIFIER_ABI[pool.version], providerOf(provider)).verifyProof(proof.pA, proof.pB, proof.pC, proof.pubSignals);
}

/**
 * Sends a withdrawal with a ready proof. The call is chosen by the pool's generation:
 *   V7 / V6: withdraw(pA, pB, pC, root, nullifierHash, recipient, relayer, fee)
 *   V5:      withdraw(pA, pB, pC, root, nullifierHash, recipient)
 * `recipient`, `relayer` and `fee` must be the ones the proof was made for (the contract checks the public signals).
 * Simulated first (opts.simulate = false skips it), so a refusal names its reason without spending gas.
 */
async function withdraw(signer, pool, proof, recipient, opts = {}) {
  if (!isSigner(signer)) throw new Error('withdraw needs an ethers Signer (or use relayWithdraw)');
  const c = poolContract(pool, signer);
  const [root, nullifierHash] = proof.pubSignals;
  const to = getAddress(recipient);
  const overrides = Object.assign(await feeOverrides(signer.provider), opts.overrides || {});
  const args = pool.feeVersion
    ? [proof.pA, proof.pB, proof.pC, root, nullifierHash, to, opts.relayer || ZeroAddress, opts.fee !== undefined ? BigInt(opts.fee) : 0n]
    : [proof.pA, proof.pB, proof.pC, root, nullifierHash, to];
  if (opts.simulate !== false) await c.withdraw.staticCall(...args);   // surfaces the pool's reason ("Invalid proof", "Unknown root", …) before any gas is spent
  const tx = await c.withdraw(...args, overrides);
  const receipt = await tx.wait();
  return { txHash: receipt.hash, receipt };
}

/** Thrown (and caught for a retry) when the pool no longer knows the root a proof names. */
const isStaleRoot = (e) => !!(e && (e.staleRoot || /Unknown root/i.test(e.shortMessage || e.message || String(e))));

/**
 * Withdraws one note end to end: finds the deposit, rebuilds the 20-level (V7/V6) or 8-level (V5) path, checks that
 * the note is unspent and the root known, makes the proof, checks it against the verifier, and sends it, from the
 * signer or (opts.viaRelayer) through the network's relayer, in which case a Provider is enough.
 *
 * @param {import('ethers').Signer|import('ethers').Provider} signerOrProvider
 * @param {object} pool          registry pool the note belongs to
 * @param {string|object} note   note text or decodeNote() result
 * @param {string} recipient
 * @param {object} [opts]        { relayer, fee, viaRelayer, circuit (loadCircuit result), circuitOpts, scanOpts, log }
 * @returns {Promise<{txHash: string, proof: object, leafIndex: number, relayed: boolean}>}
 */
async function withdrawNote(signerOrProvider, pool, note, recipient, opts = {}) {
  const n = typeof note === 'string' ? decodeNote(note) : note;
  if (n.chainId !== undefined && (n.chainId !== pool.net.chainId || n.address.toLowerCase() !== pool.address.toLowerCase())) throw new Error('This note belongs to another pool (' + n.address + ' on chain ' + n.chainId + ')');
  const provider = providerOf(signerOrProvider);
  if (!provider) throw new Error('withdrawNote needs a Signer with a provider, or a Provider with opts.viaRelayer');
  const viaRelayer = !!opts.viaRelayer;
  if (viaRelayer && !hasRelayer(pool.net)) throw new Error('This network lists no relayer in deployments.json');
  if (!viaRelayer && !isSigner(signerOrProvider)) throw new Error('A Signer is needed to send the withdrawal (or pass opts.viaRelayer)');
  const log = opts.log || (() => {});
  const to = getAddress(recipient);
  const circuit = opts.circuit || await loadCircuit(pool.circuit, opts.circuitOpts);
  const nullifierHash = computeNullifierHash(n.spendKey);
  const read = poolContract(pool, provider);

  for (let attempt = 1; ; attempt++) {
    try {
      const { leafIndex, pathElements, pathIndices, root } = await getProofInputsForCommitment(provider, pool, computeCommitment(n.spendKey, n.viewKey), opts.scanOpts);
      log(`Found deposit at leaf ${leafIndex} of ${pool.id || pool.address}`);
      if (await read.nullifierHashes(nullifierHash)) throw new Error('This note is already spent');
      if (!(await read.isKnownRoot(root))) throw Object.assign(new Error('Unknown root'), { staleRoot: true });
      const input = buildWithdrawInput({ version: pool.version, spendKey: n.spendKey, viewKey: n.viewKey, pathElements, pathIndices, root, nullifierHash, recipient: to, relayer: opts.relayer, fee: opts.fee });
      const proof = await proveWithdraw(input, circuit);
      if (pool.verifierAddr && opts.verifyOnChain !== false && !(await verifyOnChain(provider, pool, proof))) throw new Error('The verifier contract rejects this proof');
      if (viaRelayer) {
        const r = await relayWithdraw(pool, proof, to, { relayer: opts.relayer, fee: opts.fee, fetch: opts.fetch });
        return { txHash: r.tx, gasUsed: r.gasUsed, proof, leafIndex, relayed: true };
      }
      const { txHash, receipt } = await withdraw(signerOrProvider, pool, proof, to, { relayer: opts.relayer, fee: opts.fee, overrides: opts.overrides });
      return { txHash, receipt, proof, leafIndex, relayed: false };
    } catch (e) {
      if (attempt >= ROOT_RETRIES || !isStaleRoot(e)) throw e;
      log(`The pool no longer knows the root of this proof (${ROOT_HISTORY[pool.version]} newer deposits); proving again (attempt ${attempt + 1} of ${ROOT_RETRIES})`);
    }
  }
}

module.exports = { deposit, isSpent, isKnownRoot, verifyOnChain, withdraw, withdrawNote, sendWithGasMargin, feeOverrides, isStaleRoot, ROOT_RETRIES, isSigner, providerOf, poolContract };
