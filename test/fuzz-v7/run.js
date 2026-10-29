'use strict';
/*
 * Property-based (fuzz) tests for the V7 contracts on a local EVM (ganache):
 *   LatheonShieldedPoolV7Native + LatheonDistributionPoolV7Native   (native coin)
 *   LatheonShieldedPoolV7       + LatheonDistributionPoolV7         (ERC-20, LatheonToken)
 *
 * Two parts, both on every run:
 *
 *   PART A — random sequences against a BINDING MOCK verifier (many operations, fast).
 *     The mock accepts a "proof" only if pA[0] == keccak256(abi.encode(pubSignals)) and every public signal is below
 *     the field size, exactly as the real verifier refuses out-of-field signals. It therefore checks that the contracts
 *     pass the right five public signals (root, nullifierHash, recipient, relayer, fee) and that every check that lives
 *     in the CONTRACT (root history, nullifiers, fee rules, payouts, router rules, atomicity) holds. It does NOT
 *     check the circuit or the real verifier: that is part B.
 *
 *   PART B — random sequences with REAL Groth16 proofs (circuits/build/withdraw_v5, final development key) against
 *     WithdrawVerifierV5: random fees 0..DENOMINATION, tampered fee / recipient / relayer, double spend, withdrawMany
 *     with 1..16 notes and duplicates, the 100-root history (99 deposits later still valid, 100 later refused).
 *
 * Invariants checked after EVERY operation (both parts):
 *   I1 balance of each pool == (deposits - withdrawals) x DENOMINATION         (model counts, not contract state)
 *   I2 the router holds nothing (native balance / token balance) and has no allowance left to any pool
 *   I3 nextIndex == number of deposits; the pool's current root == root of an independent JS Poseidon tree
 *   I4 a nullifier is spent at most once; nullifierHashes() matches the model (sampled each step, all at the end)
 *   I5 a successful withdrawal pays recipient DENOMINATION - fee and relayer fee, nothing else moves
 *   I6 a root is accepted iff it is one of the last 100 roots of that pool (0 and random values never)
 *   I7 every refused call reverts with the reason the model predicts and changes no state
 *
 * Reproducible: SEED=<n> (default 1), OPS=<n> operations per variant in part A (default 400), REAL_OPS=<n> in part B
 * (default 24), SKIP_REAL=1 to run only part A. Local EVM only. This is an internal test, not an audit.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const solc = require('solc');
const { ethers } = require('ethers');
const { poseidon2 } = require('poseidon-lite');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(p, 'utf8');
const V5DIR = path.join(ROOT, 'circuits', 'build', 'withdraw_v5');
const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const E18 = 10n ** 18n;
const D18 = [100n * E18, 50n * E18, 10n * E18, 1n * E18];
const LEVELS = 20;
const HISTORY = 100;
const Z = ethers.ZeroAddress;
const SEED = process.env.SEED || '1';
const OPS = Number(process.env.OPS || 400);
const REAL_OPS = Number(process.env.REAL_OPS || 24);
const SKIP_REAL = process.env.SKIP_REAL === '1';

// ---------------------------------------------------------------- deterministic randomness
let ctr = 0n;
const rbytes = (n) => { const out = []; let len = 0; while (len < n) { const h = crypto.createHash('sha256').update(SEED + ':' + (ctr++)).digest(); out.push(h); len += h.length; } return Buffer.concat(out).subarray(0, n); };
const rint = (n) => Number(BigInt('0x' + rbytes(6).toString('hex')) % BigInt(n));      // 0..n-1
const chance = (p) => rint(1_000_000) < p * 1_000_000;
const rfield = () => BigInt('0x' + rbytes(31).toString('hex')) % FIELD;
const pick = (a) => a[rint(a.length)];
const raddr = () => ethers.getAddress('0x' + rbytes(20).toString('hex'));

function findImports(p) {
  for (const base of [path.join(__dirname, 'node_modules'), path.join(ROOT, 'test', 'native-v7', 'node_modules')]) {
    const f = path.join(base, p); if (fs.existsSync(f)) return { contents: read(f) };
  }
  return { error: 'not found: ' + p };
}

const DOUBLES = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
// TEST ONLY. Accepts a "proof" iff pA[0] == keccak256(abi.encode(pubSignals)) and every signal is below the field
// size (as the real Groth16 verifier). Lets a fuzzer check which public signals the pool passes, without proving.
contract BindingMockVerifier {
    uint256 constant Q = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    function verifyProof(uint256[2] calldata pA, uint256[2][2] calldata, uint256[2] calldata, uint256[5] calldata pub) external pure returns (bool) {
        for (uint256 i = 0; i < 5; i++) if (pub[i] >= Q) return false;
        return pA[0] == uint256(keccak256(abi.encode(pub)));
    }
}
// Test double: refuses the native coin.
contract RefusingRecipient { receive() external payable { revert("no thanks"); } }
`;

async function main() {
  const t0 = Date.now();
  let pass = 0, fail = 0;
  const failures = [];
  const rec = (name, ok, note) => { if (ok) pass++; else { fail++; failures.push(name + (note ? ' [' + note + ']' : '')); } if (!ok || process.env.VERBOSE) console.log((ok ? 'PASS ' : 'FAIL ') + name + (note ? '   [' + note + ']' : '')); };

  console.log('Seed ' + SEED + '. Compiling contracts from this repository...');
  const sources = {
    'contracts/PoolNative.sol': { content: read(path.join(ROOT, 'contracts', 'LatheonShieldedPoolV7Native.sol')) },
    'contracts/DistNative.sol': { content: read(path.join(ROOT, 'contracts', 'LatheonDistributionPoolV7Native.sol')) },
    'contracts/Pool.sol': { content: read(path.join(ROOT, 'contracts', 'LatheonShieldedPoolV7.sol')) },
    'contracts/Dist.sol': { content: read(path.join(ROOT, 'contracts', 'LatheonDistributionPoolV7.sol')) },
    'contracts/PoseidonT3.sol': { content: read(path.join(ROOT, 'contracts', 'PoseidonT3.sol')) },
    'contracts/Token.sol': { content: read(path.join(ROOT, 'contracts', 'LatheonToken.sol')) },
    'contracts/VerifierV5.sol': { content: read(path.join(ROOT, 'contracts', 'WithdrawVerifierV5.sol')) },
    'contracts/Doubles.sol': { content: DOUBLES },
  };
  const out = JSON.parse(solc.compile(JSON.stringify({
    language: 'Solidity', sources,
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.bytecode.linkReferences'] } } },
  }), { import: findImports }));
  const errors = (out.errors || []).filter((e) => e.severity === 'error');
  if (errors.length) { errors.forEach((e) => console.log(e.formattedMessage)); throw new Error('compilation failed'); }
  const K = (f, n) => out.contracts['contracts/' + f][n];
  const C = {
    PoolNative: K('PoolNative.sol', 'LatheonShieldedPoolV7Native'), DistNative: K('DistNative.sol', 'LatheonDistributionPoolV7Native'),
    Pool: K('Pool.sol', 'LatheonShieldedPoolV7'), Dist: K('Dist.sol', 'LatheonDistributionPoolV7'),
    Poseidon: K('PoseidonT3.sol', 'PoseidonT3'), Token: K('Token.sol', 'LatheonToken'), Ver5: K('VerifierV5.sol', 'WithdrawVerifierV5'),
    Mock: K('Doubles.sol', 'BindingMockVerifier'), Refusing: K('Doubles.sol', 'RefusingRecipient'),
  };
  const link = (c, libs) => {
    let code = c.evm.bytecode.object; const refs = c.evm.bytecode.linkReferences;
    for (const f in refs) for (const l in refs[f]) for (const { start, length } of refs[f][l])
      code = code.slice(0, start * 2) + libs[l].slice(2).toLowerCase() + code.slice(start * 2 + length * 2);
    return code;
  };

  // EVM: anvil (Foundry) when ANVIL=<path to anvil> is set or `anvil` is on PATH (about 20x faster), otherwise ganache.
  let provider, anvilProc = null;
  const anvilBin = process.env.ANVIL || (() => { try { return require('child_process').execSync('command -v anvil', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) { return ''; } })();
  if (anvilBin && process.env.GANACHE !== '1') {
    const port = 20000 + (process.pid % 20000);
    anvilProc = require('child_process').spawn(anvilBin, ['--port', String(port), '--hardfork', 'shanghai', '--gas-limit', '60000000', '--balance', '100000000', '--accounts', '4', '--silent'], { stdio: 'ignore' });
    process.on('exit', () => { try { anvilProc.kill(); } catch (e) { /* gone */ } });
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));
    provider = new ethers.JsonRpcProvider('http://127.0.0.1:' + port, 31337, { staticNetwork: true, pollingInterval: 20, cacheTimeout: -1, batchMaxCount: 1 });
    if (process.env.DEBUGRPC) provider.on('debug', (d) => { if (d.action === 'sendRpcPayload') console.log('  rpc>', JSON.stringify(d.payload).slice(0, 120)); else if (d.action === 'receiveRpcResult') console.log('  rpc<', JSON.stringify(d.result).slice(0, 100)); });
    for (let k = 0; ; k++) { try { await provider.getBlockNumber(); break; } catch (e) { if (k > 100) throw e; await new Promise((r) => setTimeout(r, 100)); } }
    console.log('EVM: anvil ' + anvilBin);
  } else {
    const ganache = require('ganache');
    const gp = ganache.provider({ logging: { quiet: true }, chain: { hardfork: 'shanghai' },
      wallet: { deterministic: true, totalAccounts: 4, defaultBalance: 100_000_000 }, miner: { blockGasLimit: 60000000 } });
    provider = new ethers.BrowserProvider(gp);
    console.log('EVM: ganache (set ANVIL=/path/to/anvil for a faster run)');
  }
  const deployer = await provider.getSigner(0);
  const sender = await provider.getSigner(1);     // a third party that sends withdrawals (relayer-like)
  const deployerAddr = await deployer.getAddress();
  // Receipt by polling: with instant mining, ethers' tx.wait() can miss the block and wait for one that never comes.
  const mined = async (txp) => {
    const tx = await txp;
    for (let k = 0; ; k++) {
      const rc = await provider.getTransactionReceipt(tx.hash);
      if (rc) { if (rc.status !== 1) { const e = new Error('transaction reverted'); e.receipt = rc; throw e; } return rc; }
      if (k > 6000) throw new Error('no receipt for ' + tx.hash);
      await new Promise((r) => setTimeout(r, 5));
    }
  };
  const deploy = async (c, args = [], libs = {}) => {
    const f = new ethers.ContractFactory(c.abi, '0x' + link(c, libs), deployer);
    const x = await f.deploy(...args); await mined(x.deploymentTransaction()); return x;
  };
  const revertMsg = (e) => [e.reason, e.shortMessage, e.message].filter(Boolean).join(' | ');
  const lib = await deploy(C.Poseidon); const libs = { PoseidonT3: await lib.getAddress() };
  const realVer = await deploy(C.Ver5);
  const mockVer = await deploy(C.Mock);
  const refusing = await deploy(C.Refusing);
  const token = await deploy(C.Token, [deployerAddr]);
  await mined(token.mint(deployerAddr, 10n ** 12n * E18));

  // ---------------------------------------------------------------- independent JS model of one pool's tree
  const ZEROS = [0n]; for (let i = 0; i < LEVELS; i++) ZEROS.push(poseidon2([ZEROS[i], ZEROS[i]]));
  class TreeModel {
    constructor() { this.leaves = []; this.filled = ZEROS.slice(0, LEVELS); this.rootsAll = [ZEROS[LEVELS]]; }
    insert(leaf) {
      let idx = this.leaves.length, h = leaf;
      for (let i = 0; i < LEVELS; i++) {
        let l, r; if (idx % 2 === 0) { l = h; r = ZEROS[i]; this.filled[i] = h; } else { l = this.filled[i]; r = h; }
        h = poseidon2([l, r]); idx = Math.floor(idx / 2);
      }
      this.leaves.push(leaf); this.rootsAll.push(h); return h;
    }
    root() { return this.rootsAll[this.rootsAll.length - 1]; }
    // The contract keeps roots[0..99] as a ring; before 100 insertions the unused slots are 0 (and 0 is refused).
    known(r) { if (r === 0n) return false; return this.rootsAll.slice(-HISTORY).includes(r); }
    stale() { return this.rootsAll.slice(0, Math.max(0, this.rootsAll.length - HISTORY)).filter((r) => !this.known(r)); }
    path(leafIdx) {
      const levels = [this.leaves.slice()];
      for (let l = 0; l < LEVELS; l++) { const cur = levels[l], up = []; for (let j = 0; j < Math.max(1, Math.ceil(cur.length / 2)); j++) up.push(poseidon2([cur[2 * j] ?? ZEROS[l], cur[2 * j + 1] ?? ZEROS[l]])); levels.push(up); }
      const el = [], idx = []; let k = leafIdx;
      for (let l = 0; l < LEVELS; l++) { el.push((levels[l][k ^ 1] ?? ZEROS[l]).toString()); idx.push(k & 1); k >>= 1; }
      return { root: levels[LEVELS][0], el, idx };
    }
  }
  const newNote = () => { const sk = rfield(), vk = rfield(); return { sk, vk, commitment: poseidon2([poseidon2([sk, vk]), 0n]), nullifier: poseidon2([sk, 1n]) }; };

  // ---------------------------------------------------------------- one fuzz target (4 pools + router)
  async function makeSet(native, real) {
    const ver = real ? realVer : mockVer;
    const ps = [];
    for (const d of D18) ps.push(native ? await deploy(C.PoolNative, [ver.target, d], libs) : await deploy(C.Pool, [token.target, ver.target, d], libs));
    const router = native ? await deploy(C.DistNative, [ps.map((p) => p.target)]) : await deploy(C.Dist, [token.target, ps.map((p) => p.target)]);
    if (!native) { await mined(token.approve(router.target, ethers.MaxUint256)); for (const p of ps) await mined(token.approve(p.target, ethers.MaxUint256)); }
    const m = ps.map((p, i) => ({ D: D18[i], tree: new TreeModel(), deposits: 0n, withdrawals: 0n, spent: new Set(), notes: [] }));
    return { native, real, ps, router, m, label: (native ? 'native' : 'erc20') + (real ? '/real' : '/mock') };
  }
  const balOf = (set, a) => (set.native ? provider.getBalance(a) : token.balanceOf(a));

  // ---- proofs
  const mockProof = (pub) => { const h = BigInt(ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['uint256[5]'], [pub]))); return { pA: [h, 0n], pB: [[0n, 0n], [0n, 0n]], pC: [0n, 0n] }; };
  let snarkjs = null; let proofMs = 0, proofs = 0;
  async function realProof(model, note, recipient, relayer, fee) {
    if (!snarkjs) snarkjs = require('snarkjs');
    const leaf = model.tree.leaves.indexOf(note.commitment);
    const { root, el, idx } = model.tree.path(leaf);
    const input = { root: root.toString(), nullifierHash: note.nullifier.toString(), recipient: BigInt(recipient).toString(), relayer: BigInt(relayer).toString(), fee: BigInt(fee).toString(),
      spendKey: note.sk.toString(), viewKey: note.vk.toString(), pathElements: el, pathIndices: idx };
    const t = Date.now();
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, path.join(V5DIR, 'withdraw_v5.wasm'), path.join(V5DIR, 'withdraw_v5_final.zkey'));
    proofMs += Date.now() - t; proofs++;
    const [pA, pB, pC] = JSON.parse('[' + (await snarkjs.groth16.exportSolidityCallData(proof, publicSignals)) + ']');
    return { pA, pB, pC, root };
  }

  // ---- deposits
  function recordDeposit(set, poolIdx, note) { const mm = set.m[poolIdx]; mm.tree.insert(note.commitment); mm.deposits++; mm.notes.push(note); }
  async function poolDeposit(set, i, note) {
    const p = set.ps[i];
    if (process.env.TRACE) console.log('  deposit', set.label, i, set.m[i].deposits);
    await mined(p.deposit(note.commitment, set.native ? { value: set.m[i].D } : {}));
    recordDeposit(set, i, note);
  }
  const splitJS = (amount) => { let rest = amount; return D18.map((d) => { const c = rest / d; rest -= c * d; return Number(c); }); };
  async function routerDeposit(set, amount, notes) {
    await mined(set.router.deposit(amount, notes.map((n) => n.commitment), set.native ? { value: amount } : {}));
    const counts = splitJS(amount); let k = 0;
    for (let i = 0; i < 4; i++) for (let n = 0; n < counts[i]; n++) recordDeposit(set, i, notes[k++]);
  }

  // ---- invariants
  async function checkInvariants(set, tag, full) {
    for (let i = 0; i < 4; i++) {
      const p = set.ps[i], mm = set.m[i];
      const b = await balOf(set, p.target);
      if (b !== (mm.deposits - mm.withdrawals) * mm.D) { rec(`${set.label} I1 pool ${i} balance (${tag})`, false, `${b} != ${(mm.deposits - mm.withdrawals) * mm.D}`); return false; }
      const ni = await p.nextIndex();
      const cri = await p.currentRootIndex();
      const r = await p.roots(cri);
      if (ni !== mm.deposits || r !== mm.tree.root()) { rec(`${set.label} I3 pool ${i} nextIndex/root (${tag})`, false, `${ni}/${mm.deposits}`); return false; }
      const sample = full ? mm.notes : (mm.notes.length ? [pick(mm.notes)] : []);
      for (const n of sample) {
        const s = await p.nullifierHashes(n.nullifier);
        if (s !== mm.spent.has(n.nullifier)) { rec(`${set.label} I4 pool ${i} nullifier state (${tag})`, false); return false; }
      }
    }
    const rb = await balOf(set, set.router.target);
    if (rb !== 0n) { rec(`${set.label} I2 router holds ${rb} (${tag})`, false); return false; }
    if (!set.native) for (const p of set.ps) { const a = await token.allowance(set.router.target, p.target); if (a !== 0n) { rec(`${set.label} I2 router allowance left (${tag})`, false, String(a)); return false; } }
    return true;
  }

  // ---- expected outcome of one withdraw() against a model (spent set may be a working copy)
  function expectWithdraw(set, i, a, spent) {
    const mm = set.m[i];
    if (a.recipient === Z) return 'Zero recipient';
    if (a.fee > mm.D) return 'Fee exceeds denomination';
    if (a.fee > 0n && a.relayer === Z) return 'Fee without relayer';
    if (!mm.tree.known(a.root)) return 'Unknown root';
    if (spent.has(a.nullifier)) return 'Note already spent';
    if (!a.validProof) return 'Invalid proof';
    if (set.native && a.recipient === refusing.target) return 'Native transfer failed';
    if (set.native && a.relayer === refusing.target && a.fee > 0n) return 'Fee transfer failed';
    return null;
  }

  // Build random withdraw arguments for a note in pool i (mock part). Returns args with the field validProof.
  function randomWithdrawArgs(set, i, note) {
    const mm = set.m[i];
    let fee = pick([0n, 0n, mm.D, 1n, mm.D - 1n, BigInt(rint(1000)) * mm.D / 1000n]);
    if (chance(0.04)) fee = mm.D + 1n;
    let relayer = chance(0.6) ? raddr() : Z;
    if (set.native && chance(0.03)) relayer = refusing.target;
    let recipient = chance(0.03) ? Z : raddr();
    if (set.native && chance(0.03)) recipient = refusing.target;
    if (chance(0.03)) relayer = recipient;   // relayer == recipient: still DENOMINATION in total
    let root = mm.tree.root();
    const r = rint(100);
    if (r < 15) { const k = mm.tree.rootsAll.slice(-HISTORY); root = pick(k); }
    else if (r < 22) { const st = mm.tree.stale(); if (st.length) root = pick(st); }
    else if (r < 26) root = rfield();
    else if (r < 28) root = 0n;
    const nullifier = note ? note.nullifier : rfield();
    const pub = [root, nullifier, BigInt(recipient), BigInt(relayer), fee];
    let proofPub = pub.slice();
    let validProof = true;
    if (chance(0.06)) { proofPub[2 + rint(3)] += 1n; validProof = false; }      // proof made for other recipient/relayer/fee
    if (!note) { validProof = false; proofPub[0] += 1n; }   // a nullifier of no deposited note: no valid proof can exist
    if (fee >= FIELD) validProof = false;
    return { root, nullifier, recipient, relayer, fee, validProof, ...mockProof(proofPub) };
  }

  async function snapshotBalances(set, addrs) { const o = {}; for (const a of new Set(addrs)) o[a] = await balOf(set, a); return o; }

  async function doWithdraw(set, i, a, from, tag) {
    const p = set.ps[i].connect(from);
    const exp = expectWithdraw(set, i, a, set.m[i].spent);
    const args = [a.pA, a.pB, a.pC, a.root, a.nullifier, a.recipient, a.relayer, a.fee];
    if (exp) {
      let got = null;
      try { await p.withdraw.staticCall(...args); } catch (e) { got = revertMsg(e); }
      const ok = got !== null && got.includes(exp);
      rec(`${set.label} I7 withdraw refused: ${exp} (${tag})`, ok, ok ? '' : String(got).slice(0, 120));
      if (chance(0.15)) {   // the real transaction too: must revert and change nothing
        let landed = false; try { const rc = await mined(p.withdraw(...args, { gasLimit: 3_000_000 })); landed = rc.status === 1; } catch (e) { /* expected */ }
        rec(`${set.label} I7 withdraw tx reverts (${tag})`, !landed);
      }
      return false;
    }
    const before = await snapshotBalances(set, [a.recipient, a.relayer].filter((x) => x !== Z));
    try { await mined(p.withdraw(...args, { gasLimit: 3_000_000 })); }
    catch (e) { let why = ''; try { await p.withdraw.staticCall(...args); } catch (e2) { why = revertMsg(e2); } rec(`${set.label} I7 withdraw expected to succeed (${tag})`, false, why.slice(0, 120)); return false; }
    set.m[i].spent.add(a.nullifier); set.m[i].withdrawals++;
    const after = await snapshotBalances(set, Object.keys(before));
    const D = set.m[i].D; const exp5 = {};
    exp5[a.recipient] = (exp5[a.recipient] || 0n) + D - a.fee; if (a.fee > 0n) exp5[a.relayer] = (exp5[a.relayer] || 0n) + a.fee;
    let ok = true; for (const k of Object.keys(before)) if (after[k] - before[k] !== (exp5[k] || 0n)) ok = false;
    rec(`${set.label} I5 payout D-fee / fee (${tag})`, ok);
    return true;
  }

  // ---- withdrawMany: items [{i, args}], shared recipient/relayer
  async function doWithdrawMany(set, items, recipient, relayer, from, tag) {
    const r = set.router.connect(from);
    let exp = null;
    if (items.length === 0) exp = 'No withdrawals';
    else if (items.length > 16) exp = 'Too many withdrawals';
    else {
      const work = set.m.map((mm) => new Set(mm.spent));
      for (const it of items) {
        if (it.i >= 4) { exp = 'Unknown pool'; break; }
        const e = expectWithdraw(set, it.i, { ...it.a, recipient, relayer }, work[it.i]);
        if (e) { exp = e; break; }
        work[it.i].add(it.a.nullifier);
      }
    }
    const enc = items.map((it) => ({ pool: it.i, pA: it.a.pA, pB: it.a.pB, pC: it.a.pC, root: it.a.root, nullifierHash: it.a.nullifier, fee: it.a.fee }));
    if (exp) {
      let got = null; try { await r.withdrawMany.staticCall(enc, recipient, relayer); } catch (e) { got = revertMsg(e); }
      const ok = got !== null && got.includes(exp);
      rec(`${set.label} I7 withdrawMany(${items.length}) refused: ${exp} (${tag})`, ok, ok ? '' : String(got).slice(0, 120));
      if (!ok && process.env.TRACE) { console.log('  recipient', recipient, 'relayer', relayer); for (const it of items) console.log('  item pool', it.i, 'nf', String(it.a.nullifier).slice(0, 12), 'spent', it.i < 4 && set.m[it.i].spent.has(it.a.nullifier), 'fee', String(it.a.fee), 'valid', it.a.validProof, 'known', it.i < 4 && set.m[it.i].tree.known(it.a.root)); for (let i = 0; i < 4; i++) console.log('  pool', i, 'bal', String(await balOf(set, set.ps[i].target))); }
      return false;
    }
    const before = await snapshotBalances(set, [recipient, relayer].filter((x) => x !== Z));
    try { await mined(r.withdrawMany(enc, recipient, relayer, { gasLimit: 30_000_000 })); }
    catch (e) { let why = ''; try { await r.withdrawMany.staticCall(enc, recipient, relayer); } catch (e2) { why = revertMsg(e2); } rec(`${set.label} I7 withdrawMany(${items.length}) expected to succeed (${tag})`, false, why.slice(0, 120)); return false; }
    let total = 0n, fees = 0n;
    for (const it of items) { set.m[it.i].spent.add(it.a.nullifier); set.m[it.i].withdrawals++; total += set.m[it.i].D; fees += it.a.fee; }
    const after = await snapshotBalances(set, Object.keys(before));
    const want = {}; want[recipient] = total - fees; if (relayer !== Z) want[relayer] = (want[relayer] || 0n) + fees;
    let ok = true; for (const k of Object.keys(before)) if (after[k] - before[k] !== (want[k] || 0n)) ok = false;
    rec(`${set.label} I5 withdrawMany(${items.length}) payouts (${tag})`, ok);
    return true;
  }

  // ---- router deposit with random (sometimes invalid) input
  async function randomRouterDeposit(set, tag) {
    let amount = BigInt(1 + rint(chance(0.1) ? 4000 : 300)) * E18;
    if (chance(0.05)) amount = 0n;
    if (chance(0.05)) amount += 1n;                      // off-grid
    const counts = amount > 0n && amount % E18 === 0n ? splitJS(amount) : [0, 0, 0, 0];
    const total = counts.reduce((x, y) => x + y, 0);
    let notes = Array.from({ length: total }, newNote);
    if (chance(0.05)) notes.push(newNote());             // wrong number
    if (total >= 2 && chance(0.05)) notes[1] = notes[0];  // duplicate
    if (total >= 2 && chance(0.03)) notes[1] = { ...notes[0], commitment: notes[0].commitment + FIELD };  // c and c+p: known, passes (THREAT-MODEL 8.5)
    let value = amount; if (set.native && chance(0.04)) value = amount + E18;
    let exp = null;
    if (set.native && value !== amount) exp = 'msg.value must equal amount';
    else if (amount === 0n) exp = 'Zero amount';
    else if (amount % E18 !== 0n) exp = 'Amount is not a multiple';
    else if (total > 32) exp = 'Too many notes';
    else if (notes.length !== total) exp = 'Wrong number of commitments';
    else if (new Set(notes.map((n) => n.commitment)).size !== notes.length) exp = 'Duplicate commitment';
    const cms = notes.map((n) => n.commitment);
    if (exp) {
      let got = null; try { await set.router.deposit.staticCall(amount, cms, set.native ? { value } : {}); } catch (e) { got = revertMsg(e); }
      rec(`${set.label} I7 router deposit refused: ${exp} (${tag})`, got !== null && got.includes(exp), got ? '' : 'did not revert');
      return;
    }
    await mined(set.router.deposit(amount, cms, set.native ? { value } : {}));
    let k = 0; for (let i = 0; i < 4; i++) for (let n = 0; n < counts[i]; n++) recordDeposit(set, i, notes[k++]);
  }

  // ================================================================ PART A
  for (const native of (process.env.ONLY === 'erc20' ? [false] : process.env.ONLY === 'native' ? [true] : [true, false])) {
    const set = await makeSet(native, false);
    console.log(`Part A ${set.label}: ${OPS} random operations...`);
    // a few known commitment-range cases (THREAT-MODEL 8.5): accepted, never withdrawable
    for (const c of [0n, FIELD, FIELD + 5n]) {
      await mined(set.ps[3].deposit(c, native ? { value: E18 } : {}));
      const mm = set.m[3]; mm.tree.insert(c); mm.deposits++;
    }
    // the JS tree must reduce like the contract: poseidon-lite reduces inputs mod p, so c and c+p hash alike
    rec(`${set.label} commitment >= p accepted (known, THREAT-MODEL 8.5) and tree still matches`, await checkInvariants(set, 'range', false));
    for (let op = 0; op < OPS; op++) {
      const tag = 'op ' + op;
      const r = rint(100);
      if (process.env.TRACE) console.log('op', op, 'r', r);
      if (r < 18) { const i = rint(4); const note = chance(0.03) && set.m[i].notes.length ? pick(set.m[i].notes) : newNote();
        if (chance(0.04)) { let got = null; try { await set.ps[i].connect(await provider.getSigner(3)).deposit.staticCall(note.commitment, native ? { value: set.m[i].D - 1n } : {}); } catch (e) { got = revertMsg(e); }
          rec(`${set.label} I7 direct deposit wrong amount / no allowance refused (${tag})`, got !== null); }
        else await poolDeposit(set, i, note); }
      else if (r < 35) await randomRouterDeposit(set, tag);
      else if (r < 37) { const i = rint(4); for (let n = 0; n < HISTORY; n++) await poolDeposit(set, i, newNote()); }   // root push-out burst
      else if (r < 75) {
        const i = rint(4); const mm = set.m[i];
        const unspent = mm.notes.filter((x) => !mm.spent.has(x.nullifier));
        const note = chance(0.05) ? null : (unspent.length && chance(0.75) ? pick(unspent) : (mm.notes.length ? pick(mm.notes) : null));
        await doWithdraw(set, i, randomWithdrawArgs(set, i, note), chance(0.5) ? deployer : sender, tag);
      } else {
        let n = 1 + rint(16); if (chance(0.03)) n = 17; if (chance(0.02)) n = 0;
        const items = [];
        for (let k = 0; k < n; k++) {
          const i = chance(0.02) ? 4 + rint(3) : rint(4); const mm = set.m[Math.min(i, 3)];
          const unspent = mm.notes.filter((x) => !mm.spent.has(x.nullifier));
          const note = chance(0.08) && items.length ? items[rint(items.length)].note : (unspent.length ? pick(unspent) : (mm.notes.length ? pick(mm.notes) : null));
          if (!note) continue;
          items.push({ i, note });
        }
        const recipient = chance(0.03) ? Z : raddr(); const relayer = chance(0.5) ? raddr() : Z;
        const built = items.map((it) => {
          const mm = set.m[Math.min(it.i, 3)];
          let fee = relayer === Z ? 0n : BigInt(rint(5)) * mm.D / 4n; if (chance(0.02)) fee = mm.D + 1n;
          const root = chance(0.9) ? mm.tree.root() : pick(mm.tree.rootsAll);
          let pub = [root, it.note.nullifier, BigInt(recipient), BigInt(relayer), fee]; let validProof = true;
          if (!mm.notes.includes(it.note)) { pub = pub.slice(); pub[0] += 1n; validProof = false; }   // a note of another pool: no valid proof for this pool
          if (chance(0.03)) { pub = pub.slice(); pub[2] += 1n; validProof = false; }
          return { i: it.i, note: it.note, a: { root, nullifier: it.note.nullifier, fee, validProof, ...mockProof(pub) } };
        });
        await doWithdrawMany(set, built, recipient, relayer, chance(0.5) ? deployer : sender, tag);
      }
      if (!(await checkInvariants(set, tag, false))) break;
    }
    rec(`${set.label} final invariants (all nullifiers)`, await checkInvariants(set, 'final', true));
    const dep = set.m.map((x) => x.deposits).join('/'), wd = set.m.map((x) => x.withdrawals).join('/');
    console.log(`  deposits per pool ${dep}, withdrawals ${wd}`);
  }

  // ================================================================ PART B (real proofs)
  if (!SKIP_REAL) for (const native of [true, false]) {
    const set = await makeSet(native, true);
    console.log(`Part B ${set.label}: real Groth16 proofs (withdraw_v5), ${REAL_OPS} random withdrawals + history + batches...`);
    for (let k = 0; k < 6; k++) { const amt = BigInt(1 + rint(300)) * E18; const c = splitJS(amt).reduce((x, y) => x + y, 0); if (c <= 32) await routerDeposit(set, amt, Array.from({ length: c }, newNote)); }
    for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) await poolDeposit(set, i, newNote());
    rec(`${set.label} invariants after deposits`, await checkInvariants(set, 'deposits', false));

    for (let op = 0; op < REAL_OPS; op++) {
      const tag = 'real op ' + op;
      const i = rint(4); const mm = set.m[i];
      const unspent = mm.notes.filter((x) => !mm.spent.has(x.nullifier)); if (!unspent.length) { await poolDeposit(set, i, newNote()); continue; }
      const note = pick(unspent);
      const fee = pick([0n, mm.D, 1n, BigInt(rint(1001)) * mm.D / 1000n]);
      const relayer = fee > 0n || chance(0.5) ? raddr() : Z;
      const recipient = raddr();
      const pr = await realProof(mm, note, recipient, relayer, fee);
      const a = { ...pr, nullifier: note.nullifier, recipient, relayer, fee, validProof: true };
      // tampering: same proof, one public value changed by the caller
      const tam = pick(['fee', 'recipient', 'relayer']);
      const t = { ...a, validProof: false };
      if (tam === 'fee') t.fee = fee === 0n ? 1n : fee - 1n; else if (tam === 'recipient') t.recipient = raddr(); else t.relayer = raddr();
      if (t.fee > 0n && t.relayer === Z) t.relayer = raddr();
      await doWithdraw(set, i, t, sender, tag + ' tampered ' + tam);
      if (chance(0.3)) await poolDeposit(set, rint(4), newNote());   // tree moves on: proof still on a known root
      await doWithdraw(set, i, a, chance(0.5) ? deployer : sender, tag);
      await doWithdraw(set, i, a, sender, tag + ' double spend');
      if (!(await checkInvariants(set, tag, false))) break;
    }

    // root history, smallest pool
    { const i = 3, mm = set.m[i]; const note = newNote(); await poolDeposit(set, i, note);
      const rcp = raddr(); const pr = await realProof(mm, note, rcp, Z, 0n);
      for (let n = 0; n < HISTORY - 1; n++) await poolDeposit(set, i, newNote());
      const ok99 = await doWithdraw(set, i, { ...pr, nullifier: note.nullifier, recipient: rcp, relayer: Z, fee: 0n, validProof: true }, sender, 'history +99');
      rec(`${set.label} I6 proof valid after 99 more deposits`, ok99);
      const note2 = newNote(); await poolDeposit(set, i, note2);
      const pr2 = await realProof(mm, note2, rcp, Z, 0n);
      for (let n = 0; n < HISTORY; n++) await poolDeposit(set, i, newNote());
      const a2 = { ...pr2, nullifier: note2.nullifier, recipient: rcp, relayer: Z, fee: 0n, validProof: true };
      rec(`${set.label} I6 model says root pushed out after 100`, !mm.tree.known(pr2.root));
      await doWithdraw(set, i, a2, sender, 'history +100 (expect Unknown root)');
      const pr3 = await realProof(mm, note2, rcp, Z, 0n);
      rec(`${set.label} I6 fresh proof for the same note withdraws`, await doWithdraw(set, i, { ...a2, ...pr3 }, sender, 'history fresh'));
    }

    // withdrawMany with real proofs: 1..16 notes, sometimes a duplicate
    for (const n of [1, 2, 5 + rint(6), 16]) {
      const recipient = raddr(); const relayer = chance(0.7) ? raddr() : Z;
      const items = [];
      while (items.length < n) {
        const i = rint(4); const mm = set.m[i];
        const unspent = mm.notes.filter((x) => !mm.spent.has(x.nullifier) && !items.some((it) => it.note === x));
        if (!unspent.length) { await poolDeposit(set, i, newNote()); continue; }
        const note = pick(unspent); const fee = relayer === Z ? 0n : BigInt(rint(5)) * mm.D / 4n;
        items.push({ i, note, fee });
      }
      const built = [];
      for (const it of items) { const pr = await realProof(set.m[it.i], it.note, recipient, relayer, it.fee); built.push({ i: it.i, note: it.note, a: { ...pr, nullifier: it.note.nullifier, fee: it.fee, validProof: true } }); }
      if (n >= 2) {   // duplicate of the first note at the end: whole batch refused, nothing moves
        const dup = built.concat([built[0]]).slice(0, 16 + 1);
        if (dup.length <= 16) await doWithdrawMany(set, dup, recipient, relayer, sender, `real batch ${n}+dup`);
        else await doWithdrawMany(set, dup, recipient, relayer, sender, `real batch 17`);
        await checkInvariants(set, 'dup', false);
        // one of the batch's own proofs with a different recipient for the batch: Invalid proof
        await doWithdrawMany(set, built.map((b, j) => (j === built.length - 1 ? { ...b, a: { ...b.a, validProof: false } } : b)), raddr(), relayer, sender, `real batch ${n} other recipient`);
      }
      await doWithdrawMany(set, built, recipient, relayer, sender, `real batch ${n}`);
      if (!(await checkInvariants(set, 'batch ' + n, false))) break;
    }
    // unknown roots
    { const i = 1, mm = set.m[i]; const note = mm.notes.find((x) => !mm.spent.has(x.nullifier)) || null;
      if (note) { const pr = await realProof(mm, note, raddr(), Z, 0n);
        await doWithdraw(set, i, { ...pr, root: rfield(), nullifier: note.nullifier, recipient: raddr(), relayer: Z, fee: 0n, validProof: false }, sender, 'random root');
        await doWithdraw(set, i, { ...pr, root: 0n, nullifier: note.nullifier, recipient: raddr(), relayer: Z, fee: 0n, validProof: false }, sender, 'root 0'); } }
    rec(`${set.label} final invariants (all nullifiers)`, await checkInvariants(set, 'final', true));
  }
  if (proofs) console.log(`Real proofs: ${proofs}, average ${Math.round(proofMs / proofs)} ms each.`);
  console.log(`\n${pass} checks passed, ${fail} failed (seed ${SEED}, ${Math.round((Date.now() - t0) / 1000)} s).`);
  if (fail) { console.log('Failures:'); failures.slice(0, 30).forEach((f) => console.log('  ' + f)); }
  if (typeof snarkjs?.thread?.terminateAll === 'function') await snarkjs.thread.terminateAll();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
