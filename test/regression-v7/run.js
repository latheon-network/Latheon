'use strict';
/*
 * Regression tests for circuits/withdraw_v5.circom and the V7 contracts (LatheonShieldedPoolV7, LatheonShieldedPoolV7Native,
 * LatheonDistributionPoolV7, LatheonDistributionPoolV7Native, WithdrawVerifierV5). Everything runs locally: snarkjs
 * against the committed files in circuits/build/withdraw_v5 (and withdraw_v4 as the unconstrained control), solc and a
 * ganache EVM inside this process. Nothing talks to a network and nothing is deployed anywhere.
 *
 *   node run.js                 # all four parts
 *   node run.js selector        # one part: selector | binding | nullifier | many
 *   CIRCOM=/path/to/circom-2.2.3 node run.js   # plus the r1cs-level check of every bad witness
 *
 * Parts:
 *   1. selector  - the bit constraint s * (1 - s) = 0 on every Merkle level: the committed final zkey carries it on each
 *                  of the 20 pathIndices wires; a selector of 2 or p-1 at each level 0..19 is refused by the witness
 *                  generator, and the same witness (made with the v4 wasm, which has no bit check) proven with the v5 key
 *                  is rejected by the v5 verification key while the v4 key accepts it; the full forgery to a live pool root
 *                  is refused by both V7 pools; honest proofs with selectors 0 and 1 at every level verify (snarkjs and
 *                  WithdrawVerifierV5).
 *   2. binding   - recipient, relayer and fee cannot be changed after the proof is made: each substitution is refused by
 *                  snarkjs, by WithdrawVerifierV5, by withdraw() of both pools and by withdrawMany() of both routers
 *                  ("Invalid proof"), the note stays unspent and no balance moves; the original tuple then pays
 *                  DENOMINATION - fee to the recipient and fee to the relayer, whoever sends the transaction.
 *   3. nullifier - a note is spent once: the same calldata, a fresh proof for another recipient and a fresh proof at a
 *                  newer root are all refused ("Note already spent"); a router batch holding a spent note, or the same
 *                  note twice, reverts as a whole and leaves every note in it unspent.
 *   4. many      - withdrawMany with 2 and 16 notes pays exactly the sum (fees included); 17 distinct valid notes are
 *                  refused ("Too many withdrawals") with nothing paid and nothing spent, and the same 17 then withdraw as
 *                  16 + 1. MAX_WITHDRAWALS is 16.
 * Uses the helpers of test/zk-review (lib.js, evm.js, circom.js) and its node_modules (or test/native's).
 */
const fs = require('fs');
const path = require('path');
const L = require('../zk-review/lib');
const evm = require('../zk-review/evm');
const circom = require('../zk-review/circom');
const { snarkjs, H, P, mod, rnd, files, note, sparsePath, forgePath, inputFor, witness, proveWtns, verify, vkeyOf, recorder, silently } = L;
const { ethers } = evm;
const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const LV = 20;
const D = 10n ** 18n;
const DENOMS = [100n * D, 50n * D, 10n * D, D];
const Z = ethers.ZeroAddress;
const J = (x) => JSON.stringify(x, (k, v) => (typeof v === 'bigint' ? v.toString() : v));
const newAddr = () => ethers.Wallet.createRandom().address;

// Root reached by a path with arbitrary selectors, computed the way MultiMux1 computes it (linear interpolation).
function rootOf(leaf, pe, s) {
  let lh = leaf;
  for (let i = 0; i < pe.length; i++) {
    const o0 = mod((pe[i] - lh) * s[i] + lh), o1 = mod((lh - pe[i]) * s[i] + pe[i]);
    lh = H(o0, o1);
  }
  return lh;
}

// ------------------------------------------------------------------------------------------------ local EVM fixtures
const C = {};
let ch, sender, deployer;
async function compileAll() {
  const c = (f) => path.join(L.ROOT, 'contracts', f);
  const out = evm.compile({
    'contracts/WithdrawVerifierV5.sol': c('WithdrawVerifierV5.sol'), 'contracts/PoseidonT3.sol': c('PoseidonT3.sol'),
    'contracts/LatheonShieldedPoolV7.sol': c('LatheonShieldedPoolV7.sol'), 'contracts/LatheonShieldedPoolV7Native.sol': c('LatheonShieldedPoolV7Native.sol'),
    'contracts/LatheonDistributionPoolV7.sol': c('LatheonDistributionPoolV7.sol'), 'contracts/LatheonDistributionPoolV7Native.sol': c('LatheonDistributionPoolV7Native.sol'),
    'contracts/LatheonToken.sol': c('LatheonToken.sol'),
  });
  const k = (f, n) => out.contracts['contracts/' + f][n];
  C.Ver = k('WithdrawVerifierV5.sol', 'WithdrawVerifierV5'); C.Poseidon = k('PoseidonT3.sol', 'PoseidonT3');
  C.Pool = k('LatheonShieldedPoolV7.sol', 'LatheonShieldedPoolV7'); C.PoolN = k('LatheonShieldedPoolV7Native.sol', 'LatheonShieldedPoolV7Native');
  C.Router = k('LatheonDistributionPoolV7.sol', 'LatheonDistributionPoolV7'); C.RouterN = k('LatheonDistributionPoolV7Native.sol', 'LatheonDistributionPoolV7Native');
  C.Token = k('LatheonToken.sol', 'LatheonToken');
}
async function openChain() {
  ch = await evm.chain();
  deployer = ch.signers[0]; sender = ch.signers[5];      // sender: an account unrelated to every note, sends all withdrawals
  const lib = await ch.deploy(C.Poseidon);
  C.libs = { PoseidonT3: await lib.getAddress() };
  C.verifier = await ch.deploy(C.Ver);
  C.verAddr = await C.verifier.getAddress();
}
// A "set": four V7 pools (100 / 50 / 10 / 1) and their router, ERC-20 or native.
async function makeSet(native) {
  const s = { native, label: native ? 'native' : 'ERC-20', leaves: new Map() };
  if (!native) s.token = await ch.deploy(C.Token, [await deployer.getAddress()]);
  s.ps = [];
  for (const d of DENOMS) s.ps.push(await ch.deploy(native ? C.PoolN : C.Pool, native ? [C.verAddr, d] : [await s.token.getAddress(), C.verAddr, d], C.libs));
  const addrs = await Promise.all(s.ps.map((p) => p.getAddress()));
  s.router = native ? await ch.deploy(C.RouterN, [addrs]) : await ch.deploy(C.Router, [await s.token.getAddress(), addrs]);
  s.bal = async (a) => (native ? ch.provider.getBalance(a) : s.token.balanceOf(a));
  s.snap = async (addrs_) => { const o = {}; for (const a of new Set(addrs_.filter((a) => a && a !== Z))) o[a] = await s.bal(a); return o; };
  s.poolBals = () => Promise.all(s.ps.map((p) => s.bal(p.target)));
  const record = (rc) => {
    for (const lg of rc.logs) for (const p of s.ps) {
      if (p.target.toLowerCase() !== lg.address.toLowerCase()) continue;
      let ev = null; try { ev = p.interface.parseLog(lg); } catch { continue; }
      if (ev && ev.name === 'Deposit') { const k = p.target.toLowerCase(); if (!s.leaves.has(k)) s.leaves.set(k, []); s.leaves.get(k)[Number(ev.args.leafIndex)] = BigInt(ev.args.commitment); }
    }
  };
  // deposit one note straight into pool i
  s.deposit = async (i, n) => {
    const p = s.ps[i];
    if (native) record(await (await p.connect(deployer).deposit(n.commitment, { value: DENOMS[i] })).wait());
    else { await (await s.token.approve(p.target, DENOMS[i])).wait(); record(await (await p.connect(deployer).deposit(n.commitment)).wait()); }
  };
  // deposit through the router: amount, notes in the router's canonical order
  s.routerDeposit = async (amount, notes) => {
    const cs = notes.map((n) => n.commitment);
    let rc;
    if (native) rc = await (await s.router.connect(deployer).deposit(amount, cs, { value: amount })).wait();
    else { await (await s.token.approve(s.router.target, amount)).wait(); rc = await (await s.router.connect(deployer).deposit(amount, cs)).wait(); }
    record(rc); return rc;
  };
  // proof for a note sitting in pool i, bound to (recipient, relayer, fee), from a local mirror of the pool's tree
  s.proof = async (i, n, recipient, relayer = Z, fee = 0n) => {
    const p = s.ps[i]; const arr = s.leaves.get(p.target.toLowerCase()) || [];
    const idx = arr.findIndex((c) => c === n.commitment); if (idx < 0) throw new Error('note not in pool ' + i);
    const pth = sparsePath(LV, new Map(arr.map((c, k) => [k, c])), idx);
    const f = files('withdraw_v5');
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(inputFor('withdraw_v5', n, pth.root, pth, { recipient: BigInt(recipient), relayer: BigInt(relayer), fee: BigInt(fee) }), f.wasm, f.zkey);
    const sol = evm.sol(proof);
    return { pool: i, sol, root: pth.root, nullifierHash: n.nullifierHash, proof, publicSignals, recipient, relayer, fee: BigInt(fee),
      args: (r = recipient, rl = relayer, fe = fee) => [sol.a, sol.b, sol.c, pth.root, n.nullifierHash, r, rl, fe],
      item: (fe = fee) => ({ pool: i, pA: sol.a, pB: sol.b, pC: sol.c, root: pth.root, nullifierHash: n.nullifierHash, fee: fe }) };
  };
  s.currentRoot = async (i) => s.ps[i].roots(await s.ps[i].currentRootIndex());
  return s;
}
// Reason from a static call, then the real transaction (fixed gas limit) must revert as well.
const reason = async (fn) => { try { await fn(); return ''; } catch (e) { return [e.reason, e.shortMessage, e.message].filter(Boolean).join(' | '); } };
async function refuse(contract, fn, args, text, overrides = {}) {
  const st = await reason(() => contract[fn].staticCall(...args, overrides));
  let real = false;
  try { const rc = await (await contract[fn](...args, { gasLimit: 30_000_000, ...overrides })).wait(); real = !rc || rc.status === 0; } catch { real = true; }
  return { ok: st.includes(text) && real, msg: st.slice(0, 70) };
}
const eventOf = (contract, rc, name) => rc.logs.map((l) => { try { return contract.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === name);

// ================================================================================================ 1. selector bit
async function partSelector() {
  const t = recorder('1. withdraw_v5: pathIndices[i] * (1 - pathIndices[i]) = 0 on every level');
  const v4 = files('withdraw_v4'), v5 = files('withdraw_v5');
  const vk4 = await vkeyOf('withdraw_v4'), vk5 = await vkeyOf('withdraw_v5');
  const b5 = circom.available() ? circom.build('withdraw_v5') : null;
  if (!b5) t.skip('r1cs-level check of each bad witness', 'set CIRCOM to a circom 2.2.3 binary');

  // (a) the committed final zkey carries s(1-s)=0 for each of the 20 selector wires (28..47 = main.pathIndices[0..19]).
  async function bitWires(name) {
    const zk = await snarkjs.zKey.exportJson(files(name).zkey);
    const byC = new Map();
    for (const c of zk.ccoefs) { if (!byC.has(c.constraint)) byC.set(c.constraint, [{}, {}]); byC.get(c.constraint)[c.matrix][c.signal] = BigInt(c.value); }
    const isBit = (lin, mono) => { const km = Object.keys(mono), kl = Object.keys(lin);
      return km.length === 1 && km[0] !== '0' && kl.length === 2 && kl.includes('0') && kl.includes(km[0]) && mod(lin['0'] + lin[km[0]]) === 0n ? Number(km[0]) : null; };
    const out = [];
    for (const [A, B] of byC.values()) { const w = isBit(A, B) ?? isBit(B, A); if (w !== null) out.push(w); }
    return out.sort((a, b) => a - b);
  }
  const want = Array.from({ length: LV }, (_, i) => 28 + i);
  const bw5 = await bitWires('withdraw_v5'), bw4 = await bitWires('withdraw_v4');
  t.rec('committed withdraw_v5_final.zkey has exactly 20 constraints s(1-s)=0, one per pathIndices wire 28..47 (withdraw_v4: none)',
    J(bw5) === J(want) && bw4.length === 0, 'v5 ' + bw5.length + ' / v4 ' + bw4.length);
  if (b5) {
    const sym = fs.readFileSync(b5.sym, 'utf8').split('\n').map((l) => l.split(',')).filter((x) => x.length === 4);
    const byWire = new Map(sym.map(([, w, , nm]) => [Number(w), nm]));
    t.rec('wires 28..47 are main.pathIndices[0..19] in the .sym of a fresh build', want.every((w, i) => byWire.get(w) === 'main.pathIndices[' + i + ']'));
  }

  // (b) an honest note in a small sparse tree; then one level at a time gets a non-binary selector.
  const n = note('split');
  const LEAF = 0b01010101010101010101;                     // bits 0 and 1 alternate along the path
  const leafMap = new Map([[LEAF, n.commitment], [0, rnd()], [LEAF ^ 1, rnd()], [(1 << LV) - 1, rnd()]]);
  const hp = sparsePath(LV, leafMap, LEAF);
  const PE = hp.pathElements, S = hp.pathIndices.map(BigInt);
  async function bad(s) {
    const inp = inputFor('withdraw_v5', n, rootOf(n.commitment, PE, s), { pathElements: PE, pathIndices: s }, { recipient: 0x1234n });
    let gen = ''; try { await silently(() => witness(v5.wasm, inp)); } catch (e) { gen = String(e.message || e); }
    const wt = await witness(v4.wasm, inp);                                   // same wire layout, no bit check
    const ok5 = await verify(vk5, ...(({ publicSignals: p, proof: q }) => [p, q])(await proveWtns(v5.zkey, wt)));
    const ok4 = await verify(vk4, ...(({ publicSignals: p, proof: q }) => [p, q])(await proveWtns(v4.zkey, wt)));
    const r1 = b5 ? await snarkjs.wtns.check(b5.r1cs, wt, quiet) : null;
    return { ok: /Assert Failed/.test(gen) && ok5 === false && ok4 === true && (b5 ? r1 === false : true), note: `gen ${gen ? 'assert' : 'NO ERROR'}, v5 ${ok5}, v4 ${ok4}` + (b5 ? `, r1cs ${r1}` : '') };
  }
  for (let lvl = 0; lvl < LV; lvl++) {
    const s2 = S.slice(); s2[lvl] = 2n;
    const sm = S.slice(); sm[lvl] = P - 1n;
    const a = await bad(s2), b = await bad(sm);
    t.rec(`level ${String(lvl).padStart(2)}: selector 2 and selector p-1 → v5 wasm refuses, v5 key rejects, v4 key accepts the same witness${b5 ? ', r1cs violated' : ''}`,
      a.ok && b.ok, a.note + ' | ' + b.note);
  }
  {
    const all = S.map(() => 2n); const r = await bad(all);
    t.rec('selector 2 on all 20 levels at once: refused', r.ok, r.note);
    const mix = S.slice(); mix[0] = (P + 1n) / 2n; mix[9] = 3n; mix[19] = P - 1n; const r2 = await bad(mix);
    t.rec('selectors (p+1)/2, 3 and p-1 on levels 0, 9, 19 at once: refused', r2.ok, r2.note);
  }
  // (c) control: with selectors 0 and 1 the same pipeline accepts. Two leaves whose bits are complementary cover both
  //     values on every level. Verified by snarkjs and by WithdrawVerifierV5 on the EVM.
  for (const [leaf, nn] of [[LEAF, n], [LEAF ^ ((1 << LV) - 1), note('split')]]) {
    const m = new Map(leafMap); m.set(leaf, nn.commitment);
    const pth = sparsePath(LV, m, leaf);
    const pr = await snarkjs.groth16.fullProve(inputFor('withdraw_v5', nn, pth.root, pth, { recipient: 0x1234n }), v5.wasm, v5.zkey);
    const s = evm.sol(pr.proof);
    t.rec(`honest path ${leaf.toString(2).padStart(LV, '0')}: verifies (snarkjs + WithdrawVerifierV5)`,
      (await verify(vk5, pr.publicSignals, pr.proof)) === true && (await C.verifier.verifyProof(s.a, s.b, s.c, pr.publicSignals)) === true);
  }
  // (d) the attack itself against both V7 pools: a never-deposited note, path forged to the pool's current root.
  for (const native of [false, true]) {
    const set = await makeSet(native);
    for (let k = 0; k < 3; k++) await set.deposit(3, note('split'));
    const pool = set.ps[3];
    const root = await set.currentRoot(3);
    const Lc = await pool.filledSubtrees(LV - 1), Rc = await pool.zeros(LV - 1);
    if (H(Lc, Rc) !== root) throw new Error('root is not H(filledSubtrees[L-1], zeros[L-1])');
    const atk = note('split'); const fp = forgePath(LV, atk.commitment, Lc, Rc);
    const recipient = newAddr();
    const wt = await witness(v4.wasm, inputFor('withdraw_v5', atk, root, fp, { recipient: BigInt(recipient) }));
    const pr = await proveWtns(v5.zkey, wt); const s = evm.sol(pr.proof);
    const r = await refuse(pool.connect(sender), 'withdraw', [s.a, s.b, s.c, root, atk.nullifierHash, recipient, Z, 0n], 'Invalid proof');
    t.rec(`${set.label} pool with 3 deposits: forged path (non-binary top selector) for a never-deposited note → "Invalid proof", balance unchanged`,
      r.ok && (await set.bal(pool.target)) === 3n * D && (await set.bal(recipient)) === 0n && (await pool.nullifierHashes(atk.nullifierHash)) === false, r.msg);
  }
  return t.done();
}

// ================================================================================================ 2. binding
async function partBinding() {
  const t = recorder('2. recipient, relayer and fee are bound into the proof');
  const vk5 = await vkeyOf('withdraw_v5');
  for (const native of [false, true]) {
    const set = await makeSet(native);
    const POOL = 2, DEN = DENOMS[POOL];                   // the 10-unit pool, fee 0.25
    const A = newAddr(), B = newAddr(), R = newAddr(), R2 = newAddr(), F = DEN / 40n;
    const n = note('split'); await set.deposit(POOL, n);
    const pr = await set.proof(POOL, n, A, R, F);
    t.rec(`${set.label}: local tree mirror reproduces the pool's current root; public signals are [root, nullifierHash, recipient, relayer, fee]`,
      pr.root === (await set.currentRoot(POOL)) && J(pr.publicSignals) === J([pr.root, n.nullifierHash, BigInt(A), BigInt(R), F].map(String)));

    // snarkjs and the bare verifier
    {
      const names = ['recipient', 'relayer', 'fee']; let ok = true; const notes = [];
      for (let i = 2; i < 5; i++) {
        const ps = pr.publicSignals.slice(); ps[i] = String(mod(BigInt(ps[i]) + 1n));
        const a = await verify(vk5, ps, pr.proof), b = await C.verifier.verifyProof(pr.sol.a, pr.sol.b, pr.sol.c, ps);
        ok = ok && a !== true && b === false; notes.push(`${names[i - 2]} snarkjs ${a} sol ${b}`);
      }
      const sw = pr.publicSignals.slice(); [sw[2], sw[3]] = [sw[3], sw[2]];
      const c = await C.verifier.verifyProof(pr.sol.a, pr.sol.b, pr.sol.c, sw);
      t.rec(`${set.label}: substituted recipient / relayer / fee (+1) and swapped recipient↔relayer are rejected by snarkjs and WithdrawVerifierV5`, ok && c === false, notes.join(', '));
    }
    // the pool
    const pool = set.ps[POOL];
    const cases = [
      ['recipient → another address', [B, R, F]],
      ['relayer → another address', [A, R2, F]],
      ['relayer → 0 and fee → 0 (fee dropped)', [A, Z, 0n]],
      ['fee → 0, relayer kept', [A, R, 0n]],
      ['fee + 1 wei', [A, R, F + 1n]],
      ['fee - 1 wei', [A, R, F - 1n]],
      ['fee → DENOMINATION', [A, R, DEN]],
      ['recipient ↔ relayer swapped', [R, A, F]],
    ];
    for (const [label, [rc, rl, fe]] of cases) {
      const watch = [A, B, R, R2, pool.target];
      const before = await set.snap(watch);
      const r = await refuse(pool.connect(sender), 'withdraw', pr.args(rc, rl, fe), 'Invalid proof');
      t.rec(`${set.label} withdraw(): ${label} → "Invalid proof", note unspent, no balance moved`,
        r.ok && (await pool.nullifierHashes(n.nullifierHash)) === false && J(before) === J(await set.snap(watch)), r.msg);
    }
    // the router (same proof, as a withdrawMany item)
    const router = set.router;
    for (const [label, items, rc, rl] of [
      ['recipient → another address', [pr.item()], B, R],
      ['relayer → another address', [pr.item()], A, R2],
      ['item fee + 1 wei', [pr.item(F + 1n)], A, R],
      ['item fee → 0', [pr.item(0n)], A, R],
    ]) {
      const watch = [A, B, R, R2, pool.target, router.target];
      const before = await set.snap(watch);
      const r = await refuse(router.connect(sender), 'withdrawMany', [items, rc, rl], 'Invalid proof');
      t.rec(`${set.label} withdrawMany(): ${label} → "Invalid proof", note unspent, no balance moved`,
        r.ok && (await pool.nullifierHashes(n.nullifierHash)) === false && J(before) === J(await set.snap(watch)), r.msg);
    }
    // the original tuple, sent by an unrelated account
    const rc = await (await pool.connect(sender).withdraw(...pr.args())).wait();
    const ev = eventOf(pool, rc, 'Withdrawal');
    t.rec(`${set.label}: the original (recipient, relayer, fee) sent by a third party pays DENOMINATION - fee to the recipient and fee to the relayer`,
      (await set.bal(A)) === DEN - F && (await set.bal(R)) === F && (await set.bal(pool.target)) === 0n && (await pool.nullifierHashes(n.nullifierHash)) === true
      && !!ev && ev.args.to === A && ev.args.relayer === R && ev.args.fee === F);
    // and through the router with a second note
    const n2 = note('split'); await set.deposit(POOL, n2);
    const pr2 = await set.proof(POOL, n2, A, R, F);
    const rc2 = await (await router.connect(sender).withdrawMany([pr2.item()], A, R)).wait();
    t.rec(`${set.label}: the same through withdrawMany(): recipient + DENOMINATION - fee, relayer + fee, router holds nothing`,
      (await set.bal(A)) === 2n * (DEN - F) && (await set.bal(R)) === 2n * F && (await set.bal(router.target)) === 0n && !!eventOf(router, rc2, 'WithdrawnMany'));
  }
  return t.done();
}

// ================================================================================================ 3. nullifier
async function partNullifier() {
  const t = recorder('3. a note is spent once (nullifier)');
  for (const native of [false, true]) {
    const set = await makeSet(native);
    const POOL = 3, pool = set.ps[POOL], router = set.router;
    const A = newAddr(), B = newAddr();
    const n = note('split'); await set.deposit(POOL, n);
    const pr1 = await set.proof(POOL, n, A);
    await (await pool.connect(sender).withdraw(...pr1.args())).wait();
    t.rec(`${set.label}: first withdrawal pays the recipient; nullifierHashes[h] becomes true`, (await set.bal(A)) === D && (await pool.nullifierHashes(n.nullifierHash)) === true);
    const before = await set.snap([A, B, pool.target]);
    const r1 = await refuse(pool.connect(sender), 'withdraw', pr1.args(), 'Note already spent');
    t.rec(`${set.label}: the same calldata again → "Note already spent"`, r1.ok && J(before) === J(await set.snap([A, B, pool.target])), r1.msg);
    const pr2 = await set.proof(POOL, n, B);
    const r2 = await refuse(pool.connect(sender), 'withdraw', pr2.args(), 'Note already spent');
    t.rec(`${set.label}: a fresh proof for the same note and another recipient (same root) → "Note already spent"`, r2.ok && (await set.bal(B)) === 0n, r2.msg);
    await set.deposit(POOL, note('split'));                       // the root moves on
    const pr3 = await set.proof(POOL, n, B);
    const r3 = await refuse(pool.connect(sender), 'withdraw', pr3.args(), 'Note already spent');
    t.rec(`${set.label}: a fresh proof at a newer root → "Note already spent" (nullifier, not root, decides)`,
      r3.ok && pr3.root !== pr1.root && (await pool.isKnownRoot(pr3.root)) === true && (await set.bal(B)) === 0n, r3.msg);
    const r4 = await refuse(router.connect(sender), 'withdrawMany', [[pr3.item()], B, Z], 'Note already spent');
    t.rec(`${set.label}: the spent note through withdrawMany() → "Note already spent"`, r4.ok, r4.msg);

    // a batch with a spent note reverts as a whole; the fresh note in it is untouched and withdraws afterwards
    const m = note('split'); await set.deposit(POOL, m);
    const prM = await set.proof(POOL, m, B);
    const poolBefore = await set.bal(pool.target);
    const r5 = await refuse(router.connect(sender), 'withdrawMany', [[prM.item(), (await set.proof(POOL, n, B)).item()], B, Z], 'Note already spent');
    t.rec(`${set.label}: batch [fresh note, spent note] reverts as a whole; the fresh note is still unspent and the pool balance unchanged`,
      r5.ok && (await pool.nullifierHashes(m.nullifierHash)) === false && (await set.bal(B)) === 0n && (await set.bal(pool.target)) === poolBefore, r5.msg);
    // the same unspent note twice in one batch (two different proofs): the second item finds it spent, everything reverts
    const prM2 = await set.proof(POOL, m, B);
    const r6 = await refuse(router.connect(sender), 'withdrawMany', [[prM.item(), prM2.item()], B, Z], 'Note already spent');
    t.rec(`${set.label}: batch [note m, note m again (another proof)] → "Note already spent"; m stays unspent (atomic)`,
      r6.ok && (await pool.nullifierHashes(m.nullifierHash)) === false && (await set.bal(B)) === 0n, r6.msg);
    await (await router.connect(sender).withdrawMany([prM.item()], B, Z)).wait();
    t.rec(`${set.label}: … and m alone withdraws afterwards`, (await set.bal(B)) === D && (await pool.nullifierHashes(m.nullifierHash)) === true);
  }
  return t.done();
}

// ================================================================================================ 4. withdrawMany
async function partMany() {
  const t = recorder('4. withdrawMany: 2 and 16 notes pay, 17 are refused');
  for (const native of [false, true]) {
    const set = await makeSet(native); const router = set.router;
    t.rec(`${set.label} router: MAX_WITHDRAWALS is 16`, (await router.MAX_WITHDRAWALS()) === 16n);

    // 17 notes through one router deposit: 399 = 3 x 100 + 50 + 4 x 10 + 9 x 1 (the canonical greedy split)
    const AMOUNT = 399n * D;
    const [counts, total] = await router.split(AMOUNT);
    t.rec(`${set.label}: split(399) = [3, 1, 4, 9] notes, 17 in all`, J(counts) === J([3n, 1n, 4n, 9n]) && total === 17n);
    const notes17 = Array.from({ length: 17 }, () => note('split'));
    const poolOf = (k) => (k < 3 ? 0 : k < 4 ? 1 : k < 8 ? 2 : 3);
    await set.routerDeposit(AMOUNT, notes17);
    const T = newAddr();
    const items17 = [];
    for (let k = 0; k < 17; k++) items17.push((await set.proof(poolOf(k), notes17[k], T)).item());
    const spentFlags = async () => Promise.all(items17.map((it, k) => set.ps[poolOf(k)].nullifierHashes(notes17[k].nullifierHash)));
    const pb0 = await set.poolBals();
    const r17 = await refuse(router.connect(sender), 'withdrawMany', [items17, T, Z], 'Too many withdrawals');
    t.rec(`${set.label}: withdrawMany with 17 distinct valid notes → "Too many withdrawals"; nothing paid, none of the 17 spent`,
      r17.ok && (await set.bal(T)) === 0n && (await spentFlags()).every((f) => f === false) && J(pb0) === J(await set.poolBals()), r17.msg);
    const r17b = await refuse(router.connect(sender), 'withdrawMany', [[...items17.slice(0, 16), items17[15]], T, Z], 'Too many withdrawals');
    t.rec(`${set.label}: 16 valid notes + a duplicate item (17) → "Too many withdrawals" (the bound is checked before any pool is called)`, r17b.ok, r17b.msg);

    const first16 = items17.slice(0, 16), sum16 = AMOUNT - D;          // all but the last 1-unit note
    const rc16 = await (await router.connect(sender).withdrawMany(first16, T, Z, { gasLimit: 30_000_000 })).wait();
    const ev16 = eventOf(router, rc16, 'WithdrawnMany');
    t.rec(`${set.label}: withdrawMany with the first 16 of them pays exactly 398 to the recipient in one transaction; WithdrawnMany(notes = 16)`,
      rc16.status === 1 && (await set.bal(T)) === sum16 && !!ev16 && ev16.args.recipient === T && ev16.args.notes === 16n, 'gas ' + rc16.gasUsed);
    const flags = await spentFlags();
    t.rec(`${set.label}: those 16 are now spent, the 17th is not; router holds nothing`, flags.slice(0, 16).every((f) => f) && flags[16] === false && (await set.bal(router.target)) === 0n);
    const rcLast = await (await router.connect(sender).withdrawMany([items17[16]], T, Z)).wait();
    t.rec(`${set.label}: the 17th note withdraws on its own with the proof made for the refused batch; recipient holds 399`,
      rcLast.status === 1 && (await set.bal(T)) === AMOUNT && (await set.poolBals()).every((b) => b === 0n));

    // 2 notes with a relayer fee bound into each proof
    const notes2 = [note('split'), note('split')];
    await set.routerDeposit(11n * D, notes2);                      // 10 + 1
    const T2 = newAddr(), R = newAddr(), FEE = D / 10n;
    const items2 = [(await set.proof(2, notes2[0], T2, R, FEE)).item(), (await set.proof(3, notes2[1], T2, R, FEE)).item()];
    const rW = await refuse(router.connect(sender), 'withdrawMany', [items2, T2, newAddr()], 'Invalid proof');
    const rc2 = await (await router.connect(sender).withdrawMany(items2, T2, R)).wait();
    const ev2 = eventOf(router, rc2, 'WithdrawnMany');
    t.rec(`${set.label}: withdrawMany with 2 notes (fee 0.1 each) pays 10.8 to the recipient and 0.2 to the relayer; another relayer is refused; WithdrawnMany(notes = 2)`,
      rW.ok && rc2.status === 1 && (await set.bal(T2)) === 11n * D - 2n * FEE && (await set.bal(R)) === 2n * FEE && !!ev2 && ev2.args.notes === 2n && (await set.poolBals()).every((b) => b === 0n), 'gas ' + rc2.gasUsed);
  }
  return t.done();
}

// ================================================================================================ runner
const PARTS = { selector: partSelector, binding: partBinding, nullifier: partNullifier, many: partMany };
async function main() {
  const only = process.argv.slice(2);
  const names = Object.keys(PARTS).filter((k) => !only.length || only.includes(k));
  if (!names.length) throw new Error('unknown part; use: ' + Object.keys(PARTS).join(' | '));
  await compileAll(); await openChain();
  let fails = 0;
  try { for (const k of names) fails += await PARTS[k](); } finally { ch.close(); }
  console.log('\n' + (fails ? 'FAILED: ' + fails + ' check(s)' : 'ALL CHECKS PASSED'));
  return fails;
}
if (require.main === module) main().then((f) => process.exit(f ? 1 : 0)).catch((e) => { console.error(e); process.exit(1); });
module.exports = { main };
