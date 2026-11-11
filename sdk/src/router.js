'use strict';
/*
 * The distribution router: any amount in one transaction (split into notes of 100 / 50 / 10 / 1 under one master key),
 * and withdrawMany: up to MAX_WITHDRAWALS (16) notes paid to one recipient in one transaction.
 */
const { Contract, ZeroAddress, getAddress, parseUnits, formatUnits } = require('ethers');
const { ROUTER_ABI, ERC20_ABI, MAX_NOTES, MAX_WITHDRAWALS, POOL_COUNT } = require('./constants');
const dist = require('../distribution');
const { assertDepositable } = require('./deployments');
const { randomFieldElement, computeZeroCascade } = require('./poseidon');
const { deriveNotes, formatMasterKey, parseMasterKey, encodeNote, MASTER_SCAN_LIMIT } = require('./notes');
const { fetchDeposits, fetchSpent, buildTreeLevels, getMerklePath } = require('./merkleTree');
const { loadCircuit, buildWithdrawInput, proveWithdraw } = require('./prove');
const { relayWithdrawMany, hasRelayer } = require('./relayer');
const { sendWithGasMargin, feeOverrides, isStaleRoot, ROOT_RETRIES, isSigner, providerOf, poolContract } = require('./pool');

const routerContract = (router, runner) => new Contract(router.address, ROUTER_ABI[router.version], runner);

/** Token amount text ('160', '0.5') -> base units of the router's token. */
const toUnits = (router, text) => parseUnits(String(text), router.decimals);
/** Base units -> token amount text. */
const fromUnits = (router, units) => formatUnits(units, router.decimals).replace(/\.0$/, '');

/**
 * How a deposit of `amount` (base units) splits into notes: { amount, remainder, counts, total, order, notes }.
 * mode 'exact' (default): the amount must be a multiple of the smallest denomination; 'round': rounded DOWN to a
 * multiple of `step` first, the remainder stays in the wallet. Throws when the split needs more than MAX_NOTES.
 */
function planDeposit(router, amount, opts = {}) {
  const mode = opts.mode || 'exact';
  const step = opts.step !== undefined ? BigInt(opts.step) : router.denominations[router.denominations.length - 1];
  const plan = dist.planDeposit(BigInt(amount), router.denominations, mode, step);
  if (plan.total > BigInt(MAX_NOTES)) throw new Error(`This amount needs ${plan.total} notes; a deposit holds at most ${MAX_NOTES}. Split it into several deposits.`);
  return Object.assign(plan, { notes: plan.order.map((d) => router.pools[router.denominations.indexOf(d)]) });
}

/**
 * Checks that the router on chain is the one deployments.json describes: token, the four pools, their denominations,
 * and that split(amount) agrees with the client mirror. Throws on any mismatch.
 */
async function checkRouterOnChain(provider, router, amount) {
  const rd = routerContract(router, providerOf(provider));
  const tokenOnChain = await rd.token();
  if (getAddress(tokenOnChain) !== getAddress(router.tok.address)) throw new Error('Router token on chain differs from deployments.json');
  for (let i = 0; i < POOL_COUNT; i++) {
    if (getAddress(await rd.pools(i)) !== router.pools[i].address) throw new Error(`Router pool ${i} on chain differs from deployments.json`);
    if ((await rd.denominations(i)) !== router.denominations[i]) throw new Error(`Router denomination ${i} on chain differs from deployments.json`);
  }
  if (amount !== undefined) {
    const [counts, total] = await rd.split(amount);
    const mirror = dist.canonicalSplit(BigInt(amount), router.denominations);
    if (total !== mirror.total || counts.some((c, i) => c !== mirror.counts[i])) throw new Error('split() on chain differs from the client mirror');
  }
  return true;
}

/**
 * Deposits `amount` (base units) through a V7 router under one fresh master key.
 * @param {object} [opts]  { mode, step, master (own master key, else random), skipChecks }
 * @returns {Promise<{masterKey: string, master: bigint, plan: object, notes: object[], txHash: string, receipt: object}>}
 *   notes[i] = { index, pool, spendKey, viewKey, commitment, nullifierHash, note }
 */
async function depositAny(signer, router, amount, opts = {}) {
  assertDepositable(router);
  if (!isSigner(signer)) throw new Error('depositAny needs an ethers Signer');
  const plan = planDeposit(router, amount, opts);
  if (!opts.skipChecks) await checkRouterOnChain(signer.provider, router, plan.amount);
  const master = opts.master !== undefined ? BigInt(opts.master) : randomFieldElement();
  const derived = deriveNotes(master, router.net.chainId, plan.total);
  const notes = derived.map((n, i) => Object.assign(n, { pool: plan.notes[i], note: encodeNote(plan.notes[i], n.spendKey, n.viewKey) }));
  const commitments = notes.map((n) => n.commitment);
  if (!router.native) {
    const token = new Contract(router.tok.address, ERC20_ABI, signer);
    const owner = await signer.getAddress();
    if ((await token.allowance(owner, router.address)) < plan.amount) await (await token.approve(router.address, plan.amount)).wait();
  }
  const tx = await sendWithGasMargin(routerContract(router, signer), 'deposit', [plan.amount, commitments], router.native ? { value: plan.amount } : {});
  const receipt = await tx.wait();
  return { masterKey: formatMasterKey(router.net.chainId, router.address, master), master, plan, notes, txHash: receipt.hash, receipt };
}

/**
 * The notes of a master key in a router's four pools, with their spent status.
 * Scans the pools' deposits, derives notes 0 .. MASTER_SCAN_LIMIT-1 and keeps those found on chain.
 * @param {string|object} masterKey   text or parseMasterKey() result; its router must be `router`
 * @param {object} [opts]  { scanOpts, scanLimit, minBlock, deposits, spent }: minBlock = the deposit's receipt.blockNumber when scanning right after depositing;
 *   deposits = the four pools' fetchDeposits() results, to reuse one scan for several master keys (never reuse `spent`,
 *   the four pools' fetchSpent() results, across a withdrawal: it would be out of date)
 * @returns {Promise<{notes: object[], deposits: object[][], spent: Set<bigint>[], unspent: object[], total: bigint}>}
 *   notes[i] = { index, poolIndex, pool, leafIndex, value (whole tokens), spendKey, viewKey, commitment, nullifierHash, note, spent }
 */
async function findNotes(provider, router, masterKey, opts = {}) {
  const mk = typeof masterKey === 'string' ? parseMasterKey(masterKey) : masterKey;
  if (mk.chainId !== router.net.chainId || mk.router.toLowerCase() !== router.address.toLowerCase()) throw new Error(`This master key belongs to router ${mk.router} on chain ${mk.chainId}, not to ${router.id || router.address}`);
  const p = providerOf(provider);
  const scanOpts = Object.assign({}, opts.scanOpts, opts.minBlock !== undefined ? { minBlock: opts.minBlock } : {});
  const deposits = opts.deposits || await Promise.all(router.pools.map((pool) => fetchDeposits(p, pool, scanOpts)));
  const byCommit = new Map();
  deposits.forEach((list, pi) => list.forEach((d) => byCommit.set(d.commitment, { pi, leafIndex: d.leafIndex, timestamp: d.timestamp })));
  const notes = [];
  for (const k of deriveNotes(mk.master, mk.chainId, opts.scanLimit || MASTER_SCAN_LIMIT)) {
    const hit = byCommit.get(k.commitment);
    if (!hit) continue;
    const pool = router.pools[hit.pi];
    notes.push(Object.assign(k, { poolIndex: hit.pi, pool, leafIndex: hit.leafIndex, timestamp: hit.timestamp, value: pool.amount, note: encodeNote(pool, k.spendKey, k.viewKey) }));
  }
  // Spent or not: from all withdrawals of the four pools (fetchSpent), never by asking about these notes one by one,
  // which would show the RPC endpoint that they belong to one owner.
  const spent = opts.spent || await Promise.all(router.pools.map((pool) => fetchSpent(p, pool, scanOpts)));
  for (const n of notes) n.spent = spent[n.poolIndex].has(n.nullifierHash);
  const unspent = notes.filter((n) => !n.spent);
  return { master: mk, notes, deposits, spent, unspent, total: unspent.reduce((s, n) => s + n.pool.denomination, 0n) };
}

/**
 * Picks unspent notes that add up to exactly `amountTokens` (a whole number of tokens), as few as possible.
 * @returns {{chosen: object[]|null, nearest: number}}  nearest: the largest reachable sum below the target when none fits
 */
function selectNotesForAmount(notes, amountTokens) {
  return dist.selectNotes(notes.filter((n) => !n.spent), Number(amountTokens));
}

/** One withdrawMany item (array form, exactly what the contract tuple and the relayer take). */
function buildWithdrawManyItem(router, poolIndex, proof, fee = 0n) {
  if (!Number.isInteger(poolIndex) || poolIndex < 0 || poolIndex >= POOL_COUNT) throw new Error('poolIndex must be 0..3');
  const base = [poolIndex, proof.pA, proof.pB, proof.pC, proof.pubSignals[0], proof.pubSignals[1]];
  return router.feeVersion ? base.concat([BigInt(fee)]) : base;
}

/** Splits items into batches of at most `max` (MAX_WITHDRAWALS) for withdrawMany. */
function batchItems(items, max = MAX_WITHDRAWALS) {
  if (!Number.isInteger(max) || max < 1) throw new Error('bad batch size');
  const out = [];
  for (let i = 0; i < items.length; i += max) out.push(items.slice(i, i + max));
  return out;
}

/**
 * Sends one withdrawMany batch (at most MAX_WITHDRAWALS items) from the signer.
 *   V7 / V6: withdrawMany(items with fee, recipient, relayer)
 *   V5:      withdrawMany(items, recipient)
 */
async function withdrawMany(signer, router, items, recipient, opts = {}) {
  if (!isSigner(signer)) throw new Error('withdrawMany needs an ethers Signer (or use relayWithdrawMany)');
  if (!items.length) throw new Error('No withdrawals');
  if (items.length > MAX_WITHDRAWALS) throw new Error(`At most ${MAX_WITHDRAWALS} notes per withdrawMany; use batchItems()`);
  const c = routerContract(router, signer);
  const to = getAddress(recipient);
  const overrides = Object.assign(await feeOverrides(signer.provider), opts.overrides || {});
  const args = router.feeVersion ? [items, to, opts.relayer || ZeroAddress] : [items, to];
  if (opts.simulate !== false) await c.withdrawMany.staticCall(...args);   // refuses early, before any gas is spent
  const tx = await c.withdrawMany(...args, overrides);
  const receipt = await tx.wait();
  return { txHash: receipt.hash, receipt };
}

/**
 * Withdraws exactly `amountTokens` (whole tokens) of a master key's notes to `recipient`, in as few notes as possible,
 * one withdrawMany per batch of 16, from the signer or (opts.viaRelayer) through the relayer.
 * Proofs are made per note against each pool's current root; a pool that forgets a root before a batch is sent
 * ("Unknown root") gets fresh proofs for the notes not yet paid (ROOT_RETRIES attempts in all).
 *
 * @param {object} [opts]  { relayer, fee (per note, V7/V6), viaRelayer, circuit, circuitOpts, scanOpts, minBlock, notes (a findNotes() result to reuse), log, onProof }
 * @returns {Promise<{txHashes: string[], notes: object[], batches: number, relayed: boolean}>}
 */
async function withdrawByAmount(signerOrProvider, router, masterKey, amountTokens, recipient, opts = {}) {
  const provider = providerOf(signerOrProvider);
  if (!provider) throw new Error('withdrawByAmount needs a Signer with a provider, or a Provider with opts.viaRelayer');
  const viaRelayer = !!opts.viaRelayer;
  if (viaRelayer && !hasRelayer(router.net)) throw new Error('This network lists no relayer in deployments.json');
  if (!viaRelayer && !isSigner(signerOrProvider)) throw new Error('A Signer is needed to send the withdrawal (or pass opts.viaRelayer)');
  const log = opts.log || (() => {});
  const to = getAddress(recipient);
  const fee = opts.fee !== undefined ? BigInt(opts.fee) : 0n;
  const relayerAddr = opts.relayer || ZeroAddress;
  const circuit = opts.circuit || await loadCircuit(router.circuit, opts.circuitOpts);

  let found = opts.notes || await findNotes(provider, router, masterKey, opts);
  const sel = selectNotesForAmount(found.notes, amountTokens);
  if (!sel.chosen) throw new Error(`No set of unspent notes adds up to exactly ${amountTokens} ${router.token}; the nearest reachable sum is ${sel.nearest}`);
  const zeros = computeZeroCascade(router.levels);
  const chosen = sel.chosen.slice().sort((a, b) => a.poolIndex - b.poolIndex || a.leafIndex - b.leafIndex);
  let pending = chosen.slice(), depositsNow = found.deposits;
  const txHashes = [], scheduled = [];   // scheduled: delayed batches the relayer accepted (opts.delay), not sent yet
  let batches = 0;

  for (let attempt = 1; ; attempt++) {
    try {
      const trees = {}, rootChecked = {}, items = [];
      for (let i = 0; i < pending.length; i++) {
        const n = pending[i];
        if (!trees[n.poolIndex]) { const leaves = []; for (const d of depositsNow[n.poolIndex]) leaves[d.leafIndex] = d.commitment; trees[n.poolIndex] = buildTreeLevels(leaves, zeros); }
        const { pathElements, pathIndices, root } = getMerklePath(trees[n.poolIndex], n.leafIndex, zeros);
        if (rootChecked[n.poolIndex] !== root) {
          if (!(await poolContract(n.pool, provider).isKnownRoot(root))) throw Object.assign(new Error('Unknown root'), { staleRoot: true });
          rootChecked[n.poolIndex] = root;
        }
        const input = buildWithdrawInput({ version: router.version, spendKey: n.spendKey, viewKey: n.viewKey, pathElements, pathIndices, root, nullifierHash: n.nullifierHash, recipient: to, relayer: router.feeVersion ? relayerAddr : undefined, fee: router.feeVersion ? fee : undefined });
        const proof = await proveWithdraw(input, circuit);
        items.push(buildWithdrawManyItem(router, n.poolIndex, proof, fee));
        log(`Proof ${i + 1}/${pending.length} made (${n.pool.amount} ${router.token}, leaf ${n.leafIndex})`);
        if (opts.onProof) opts.onProof(i + 1, pending.length, n);
      }
      const groups = batchItems(items, opts.batchSize || MAX_WITHDRAWALS);
      const read = routerContract(router, provider);
      for (const b of groups) await read.withdrawMany.staticCall(...(router.feeVersion ? [b, to, relayerAddr] : [b, to]));
      for (const b of groups) {
        if (viaRelayer) {
          const r = await relayWithdrawMany(router, b, to, { relayer: relayerAddr, fetch: opts.fetch, delay: opts.delay });
          if (r.scheduled) { scheduled.push({ id: r.id, notAfter: r.notAfter, notes: b.length }); log('Delayed withdrawMany accepted, to be sent before ' + r.notAfter); }
          else { txHashes.push(r.tx); log('Relayed withdrawMany tx ' + r.tx); }
        }
        else { const { txHash } = await withdrawMany(signerOrProvider, router, b, to, { relayer: relayerAddr, simulate: false, overrides: opts.overrides }); txHashes.push(txHash); log('withdrawMany tx ' + txHash); }
        batches++;
        pending = pending.slice(b.length);   // this batch is paid
      }
      return Object.assign({ txHashes, notes: chosen, batches, relayed: viaRelayer }, scheduled.length ? { scheduled } : {});
    } catch (e) {
      if (attempt >= ROOT_RETRIES || !isStaleRoot(e)) throw e;
      log(`A pool no longer knows the root of these proofs; ${pending.length} note(s) left: scanning again (attempt ${attempt + 1} of ${ROOT_RETRIES})`);
      depositsNow = await Promise.all(router.pools.map((pool) => fetchDeposits(provider, pool, opts.scanOpts)));
    }
  }
}

module.exports = { toUnits, fromUnits, planDeposit, checkRouterOnChain, depositAny, findNotes, selectNotesForAmount, buildWithdrawManyItem, batchItems, withdrawMany, withdrawByAmount, routerContract };
