'use strict';
/*
 * P1.2 / P1.3 — withdraw_v5 (V7): malformed witnesses are refused, honest proofs at the edges of the tree pass.
 *
 * Negative: for every bad witness we check three layers independently —
 *   (a) the committed withdraw_v5.wasm refuses to compute it (assert in the witness generator),
 *   (b) the same witness computed with the committed withdraw_v4.wasm (same wire layout, no bit check) and proven with
 *       the committed FINAL withdraw_v5 zkey is rejected by the v5 verification key — while the identical witness is
 *       accepted under the v4 key, so the rejection is due to the new constraint, not to a broken witness,
 *   (c) with $CIRCOM: the witness violates the r1cs built from circuits/withdraw_v5.circom.
 * Cases: non-binary selector 2 at every level 0..19, values p-1 and (p+1)/2, several levels at once, the full forgery to
 * a pool root; and an honest proof with root / nullifierHash / recipient / relayer / fee substituted (snarkjs and
 * contracts/WithdrawVerifierV5.sol), each public input pushed to x + p (non-canonical), and a forged proof sent to a
 * V7 pool (local EVM). Positive: honest proofs at leaf 0, 2^20-1 and mixed indices, with relayer/fee and a max address.
 * Local only. Internal review, not an audit.
 */
const fs = require('fs');
const path = require('path');
const L = require('./lib');
const { snarkjs, H, P, mod, rnd, files, note, sparsePath, forgePath, inputFor, witness, proveWtns, verify, vkeyOf, recorder, silently } = L;
const evm = require('./evm');
const circom = require('./circom');
const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const LV = 20;

// Root reached by a path with arbitrary selectors, computed the way MultiMux1 computes it.
function rootOf(leaf, pe, s) {
  let lh = leaf;
  for (let i = 0; i < pe.length; i++) {
    const o0 = mod((pe[i] - lh) * s[i] + lh), o1 = mod((lh - pe[i]) * s[i] + pe[i]);
    lh = H(o0, o1);
  }
  return lh;
}

async function main() {
  const t = recorder('P1.2/P1.3 withdraw_v5 (V7): malformed witnesses refused, edge cases accepted');
  const v4 = files('withdraw_v4'), v5 = files('withdraw_v5');
  const vk4 = await vkeyOf('withdraw_v4'), vk5 = await vkeyOf('withdraw_v5');
  const b5 = circom.available() ? circom.build('withdraw_v5') : null;
  if (!b5) t.skip('r1cs-level checks', 'set CIRCOM to a circom 2.2.3 binary');

  async function negative(label, inp) {
    let genErr = '';
    try { await silently(() => witness(v5.wasm, inp)); } catch (e) { genErr = String(e.message || e); }
    const wt = await witness(v4.wasm, inp);
    const p5 = await proveWtns(v5.zkey, wt); const ok5 = await verify(vk5, p5.publicSignals, p5.proof);
    const p4 = await proveWtns(v4.zkey, wt); const ok4 = await verify(vk4, p4.publicSignals, p4.proof);
    let r1 = 'n/a';
    if (b5) r1 = await snarkjs.wtns.check(b5.r1cs, wt, quiet);
    t.rec(`${label}: v5 wasm refuses, v5 key rejects (v4 key accepts the same witness)${b5 ? ', r1cs violated' : ''}`,
      /Assert Failed/.test(genErr) && ok5 === false && ok4 === true && (b5 ? r1 === false : true),
      `gen: ${genErr ? 'assert' : 'NO ERROR'}, v5 ${ok5}, v4 ${ok4}, r1cs ${r1}`);
    return { p5 };
  }

  // (0) the key itself carries the fix: constraints of the form s * (1 - s) = 0 (A = {1, -s}, B = {s} or swapped) in the
  // final zkey's coefficient section. Wires 28..47 are pathIndices[0..19] (inputs follow the 5 public signals, spendKey,
  // viewKey and 20 pathElements; checked against the .sym file when $CIRCOM is set).
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
  const want = Array.from({ length: 20 }, (_, i) => 28 + i);
  const bw5 = await bitWires('withdraw_v5'), bw4 = await bitWires('withdraw_v4');
  t.rec('final withdraw_v5 zkey contains the 20 bit constraints s(1-s)=0 on wires 28..47; the v4 zkey contains none',
    JSON.stringify(bw5) === JSON.stringify(want) && bw4.length === 0, 'v5: ' + bw5.length + ', v4: ' + bw4.length);
  if (b5) {
    const sym = fs.readFileSync(b5.sym, 'utf8').split('\n').map((l) => l.split(',')).filter((x) => x.length === 4);
    const byWire = new Map(sym.map(([, w, , nm]) => [Number(w), nm]));
    t.rec('…and wires 28..47 are main.pathIndices[0..19] in the .sym of the fresh build', want.every((w, i) => byWire.get(w) === 'main.pathIndices[' + i + ']'));
  }

  // Base: an honest note at some leaf of a small tree.
  const n = note('split');
  const leafMap = new Map([[5, n.commitment], [0, rnd()], [6, rnd()]]);
  const hp = sparsePath(LV, leafMap, 5);
  const honestPE = hp.pathElements, honestS = hp.pathIndices.map(BigInt);

  // (1) selector = 2 at each level, everything else honest; root follows the non-binary path.
  for (let lvl = 0; lvl < LV; lvl++) {
    const s = honestS.slice(); s[lvl] = 2n;
    const root = rootOf(n.commitment, honestPE, s);
    await negative(`selector 2 at level ${lvl}`, inputFor('withdraw_v5', n, root, { pathElements: honestPE, pathIndices: s }, { recipient: 0x1234n }));
  }
  // (2) special values.
  for (const [lbl, val] of [['p-1', P - 1n], ['(p+1)/2', (P + 1n) / 2n], ['random field element', rnd()]]) {
    for (const lvl of [0, 19]) {
      const s = honestS.slice(); s[lvl] = val;
      await negative(`selector ${lbl} at level ${lvl}`, inputFor('withdraw_v5', n, rootOf(n.commitment, honestPE, s), { pathElements: honestPE, pathIndices: s }, { recipient: 0x1234n }));
    }
  }
  // (3) several levels at once.
  {
    const s = honestS.slice(); s[0] = 2n; s[7] = P - 1n; s[13] = (P + 1n) / 2n; s[19] = 3n;
    await negative('selectors non-binary at levels 0, 7, 13, 19 at once', inputFor('withdraw_v5', n, rootOf(n.commitment, honestPE, s), { pathElements: honestPE, pathIndices: s }, { recipient: 0x1234n }));
    const all = honestS.map(() => 2n);
    await negative('selector 2 at all 20 levels', inputFor('withdraw_v5', n, rootOf(n.commitment, honestPE, all), { pathElements: honestPE, pathIndices: all }, { recipient: 0x1234n }));
  }
  // (4) the actual attack: a never-deposited note to a real pool root.
  {
    const z = L.zeros(LV);
    const poolLeaves = new Map([[0, rnd()], [1, rnd()], [2, rnd()]]);
    const root = sparsePath(LV, poolLeaves, 0).root;
    // children of the root: left = node(L-1, 0), right = zeros[L-1]
    let level = new Map(poolLeaves);
    for (let l = 0; l < LV - 1; l++) { const up = new Map(); for (const k of level.keys()) { const p = k >> 1; if (!up.has(p)) up.set(p, H(level.get(2 * p) ?? z[l], level.get(2 * p + 1) ?? z[l])); } level = up; }
    const Lc = level.get(0), Rc = z[LV - 1];
    if (H(Lc, Rc) !== root) throw new Error('root children');
    const atk = note('split');
    const fp = forgePath(LV, atk.commitment, Lc, Rc);
    await negative('forgery to a pool root (THREAT-MODEL §8.0 attack)', inputFor('withdraw_v5', atk, root, fp, { recipient: 0x1234n }));
  }
  // (5) honest witness with a root that does not match the path: the generator refuses.
  {
    let err = '';
    try { await silently(() => witness(v5.wasm, inputFor('withdraw_v5', n, mod(hp.root + 1n), hp))); } catch (e) { err = String(e.message); }
    t.rec('honest path with a wrong root: v5 wasm refuses', /Assert Failed/.test(err));
    let err2 = '';
    const bad = { ...n, nullifierHash: mod(n.nullifierHash + 1n) };
    try { await silently(() => witness(v5.wasm, inputFor('withdraw_v5', bad, hp.root, hp))); } catch (e) { err2 = String(e.message); }
    t.rec('honest path with a wrong nullifierHash: v5 wasm refuses', /Assert Failed/.test(err2));
  }

  // (6) public-input substitution on an honest proof — snarkjs and the Solidity verifier.
  const out = evm.compile({ 'contracts/V5.sol': path.join(L.ROOT, 'contracts', 'WithdrawVerifierV5.sol'),
    'contracts/Pool.sol': path.join(L.ROOT, 'contracts', 'LatheonShieldedPoolV7Native.sol'), 'contracts/PoseidonT3.sol': path.join(L.ROOT, 'contracts', 'PoseidonT3.sol') });
  const ch = await evm.chain();
  try {
    const ver = await ch.deploy(out.contracts['contracts/V5.sol'].WithdrawVerifierV5);
    const recip = 0x00000000000000000000000000000000000000a1n, rel = 0x00000000000000000000000000000000000000b2n, fee = 12345n;
    const honest = await snarkjs.groth16.fullProve(inputFor('withdraw_v5', n, hp.root, hp, { recipient: recip, relayer: rel, fee }), v5.wasm, v5.zkey);
    const s = evm.sol(honest.proof);
    t.rec('honest proof (relayer + fee) verifies in snarkjs and in WithdrawVerifierV5',
      (await verify(vk5, honest.publicSignals, honest.proof)) === true && (await ver.verifyProof(s.a, s.b, s.c, honest.publicSignals)) === true);
    t.rec('publicSignals order from the circuit is [root, nullifierHash, recipient, relayer, fee]',
      JSON.stringify(honest.publicSignals) === JSON.stringify([hp.root, n.nullifierHash, recip, rel, fee].map(String)));
    const names = ['root', 'nullifierHash', 'recipient', 'relayer', 'fee'];
    for (let i = 0; i < 5; i++) {
      const ps = honest.publicSignals.slice(); ps[i] = String(mod(BigInt(ps[i]) + 1n));
      const a = await verify(vk5, ps, honest.proof), b = await ver.verifyProof(s.a, s.b, s.c, ps);
      t.rec(`substituted ${names[i]} (+1): rejected by snarkjs and WithdrawVerifierV5`, a !== true && b === false, `snarkjs ${a}, sol ${b}`);
      const ps2 = honest.publicSignals.slice(); ps2[i] = String(BigInt(ps2[i]) + P);
      const a2 = await verify(vk5, ps2, honest.proof), b2 = await ver.verifyProof(s.a, s.b, s.c, ps2);
      t.rec(`non-canonical ${names[i]} (x + p): rejected by snarkjs and WithdrawVerifierV5 (checkField)`, a2 !== true && b2 === false, `snarkjs ${a2}, sol ${b2}`);
    }
    // swapped recipient/relayer
    const sw = honest.publicSignals.slice(); [sw[2], sw[3]] = [sw[3], sw[2]];
    t.rec('recipient and relayer swapped: rejected', (await ver.verifyProof(s.a, s.b, s.c, sw)) === false);

    // (7) forged proof (v4 wasm witness + v5 key) submitted to a V7 pool: refused, balance unchanged.
    const lib = await ch.deploy(out.contracts['contracts/PoseidonT3.sol'].PoseidonT3);
    const D = 10n ** 18n;
    const pool = await ch.deploy(out.contracts['contracts/Pool.sol'].LatheonShieldedPoolV7Native, [await ver.getAddress(), D], { PoseidonT3: await lib.getAddress() });
    for (let k = 0; k < 3; k++) await (await pool.connect(ch.signers[1 + k]).deposit(note('split').commitment, { value: D })).wait();
    const root = await pool.roots(await pool.currentRootIndex());
    const Lc = await pool.filledSubtrees(LV - 1), Rc = await pool.zeros(LV - 1);
    const atk = note('split'); const fp = forgePath(LV, atk.commitment, Lc, Rc);
    const recipient = evm.ethers.Wallet.createRandom().address;
    const wt = await witness(v4.wasm, inputFor('withdraw_v5', atk, root, fp, { recipient: BigInt(recipient) }));
    const pr = await proveWtns(v5.zkey, wt); const ps = evm.sol(pr.proof);
    let msg = '';
    try { await pool.connect(ch.signers[5]).withdraw.staticCall(ps.a, ps.b, ps.c, root, atk.nullifierHash, recipient, evm.ethers.ZeroAddress, 0); } catch (e) { msg = e.reason || e.shortMessage || e.message; }
    t.rec('forged proof sent to a V7 pool with 3 deposits: "Invalid proof", pool balance unchanged',
      /Invalid proof/.test(msg) && (await ch.provider.getBalance(await pool.getAddress())) === 3n * D, msg.slice(0, 40));

    // (8) positive: honest proofs at the edges of a 2^20 tree.
    const edge = new Map();
    const idxs = [0, 1, 0b10101010101010101010, 0b01010101010101010101, (1 << 19), (1 << 20) - 2, (1 << 20) - 1];
    const notes = idxs.map(() => note('split'));
    idxs.forEach((i, k) => edge.set(i, notes[k].commitment));
    for (let k = 0; k < idxs.length; k++) {
      const p_ = sparsePath(LV, edge, idxs[k]);
      const maxAddr = (1n << 160n) - 1n;
      const pr2 = await snarkjs.groth16.fullProve(inputFor('withdraw_v5', notes[k], p_.root, p_, { recipient: maxAddr, relayer: k % 2 ? maxAddr - 1n : 0n, fee: k % 2 ? 10n ** 18n : 0n }), v5.wasm, v5.zkey);
      const s2 = evm.sol(pr2.proof);
      t.rec(`honest proof at leaf ${idxs[k]} (path bits ${idxs[k].toString(2).padStart(20, '0')}) verifies (snarkjs + Solidity)`,
        (await verify(vk5, pr2.publicSignals, pr2.proof)) === true && (await ver.verifyProof(s2.a, s2.b, s2.c, pr2.publicSignals)) === true);
    }
  } finally { ch.close(); }

  const fails = t.done();
  process.exitCode = fails ? 1 : 0;
  return fails;
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); }).then(() => process.exit(process.exitCode || 0));
module.exports = { main };
