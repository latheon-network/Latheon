'use strict';
/*
 * P2 — the rest of the ZK construction, as executable checks. Internal review, not an audit. Local only.
 *   A. Poseidon: poseidon-lite (node) = the demo's vendored browser bundle (demo/vendor/poseidon-lite-*.mjs)
 *      = PoseidonT3.sol on a local EVM = circomlib Poseidon inside the committed circuits (witness generation succeeds
 *      only if the circuit's hash equals the JS value), on edge and random vectors.
 *   B. Merkle tree of the V7 pool: zeros, incremental roots after each deposit = JS tree, root 0 never known.
 *   C. Notes and nullifiers: one note has exactly one nullifierHash (non-canonical spendKey = same nullifier; the same
 *      commitment at two leaves = same nullifier, second withdrawal refused); two notes sharing a spendKey share a
 *      nullifier (design note: spendKey must be unique per note).
 *   D. Selective disclosure (disclose.circom, DiscloseVerifier.sol): honest proof verifies; the proof is bound to the
 *      nonce (replay with another nonce, a recomputed tag, another commitment: rejected); nonce >= p rejected; the
 *      generator refuses to prove for a commitment whose keys the prover does not have.
 *   E. Trusted setup: phase-2 contribution records inside each zkey (count, names, delta chain end = vk delta).
 */
const fs = require('fs');
const path = require('path');
const L = require('./lib');
const { snarkjs, H, P, mod, rnd, files, note, sparsePath, inputFor, witness, verify, vkeyOf, recorder, poseidon2, ROOT, BUILD, silently } = L;
const evm = require('./evm');
const LV = 20;
const quiet = { info() {}, warn() {}, error() {}, debug() {} };

async function main() {
  const t = recorder('P2 construction: Poseidon, tree, notes/nullifiers, disclosure, setup records');
  const out = evm.compile({ 'contracts/PoseidonT3.sol': path.join(ROOT, 'contracts', 'PoseidonT3.sol'),
    'contracts/Pool.sol': path.join(ROOT, 'contracts', 'LatheonShieldedPoolV7Native.sol'),
    'contracts/V5.sol': path.join(ROOT, 'contracts', 'WithdrawVerifierV5.sol'),
    'contracts/D.sol': path.join(ROOT, 'contracts', 'DiscloseVerifier.sol'),
    'contracts/Probe.sol': `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "./PoseidonT3.sol";
contract Probe { function h(uint256 a, uint256 b) external pure returns (uint256) { return PoseidonT3.hash([a, b]); } }
` });
  const ch = await evm.chain();
  try {
    const lib = await ch.deploy(out.contracts['contracts/PoseidonT3.sol'].PoseidonT3);
    const libs = { PoseidonT3: await lib.getAddress() };
    const probe = await ch.deploy(out.contracts['contracts/Probe.sol'].Probe, [], libs);

    // ---- A. Poseidon
    const vendored = fs.readdirSync(path.join(ROOT, 'demo', 'vendor')).find((f) => /^poseidon-lite-.*\.mjs$/.test(f));
    const pv = vendored ? await import(path.join(ROOT, 'demo', 'vendor', vendored)) : null;
    const vec = [[0n, 0n], [0n, 1n], [1n, 0n], [1n, 2n], [P - 1n, P - 1n], [P - 1n, 0n], [rnd(), rnd()], [rnd(), 0n], [rnd(), 1n]];
    let okSol = true, okVendor = !!pv;
    for (const [a, b] of vec) {
      const js = poseidon2([a, b]);
      if ((await probe.h(a, b)) !== js) okSol = false;
      if (pv && pv.poseidon2([a, b]) !== js) okVendor = false;
    }
    t.rec(`PoseidonT3.sol = poseidon-lite on ${vec.length} vectors (0, 1, p-1, random)`, okSol);
    t.rec(`demo/vendor/${vendored || 'poseidon-lite-*.mjs'} (browser bundle) = poseidon-lite in node`, okVendor);
    t.rec('known vector: Poseidon(1, 2) = 0x115cc0f5…189a (circomlibjs reference)', poseidon2([1n, 2n]) === 0x115cc0f5e7d690413df64c6b9662e9cf2a3617f2743245519e19607a4417189an);
    const red = (await probe.h(5n + P, 7n)) === (await probe.h(5n, 7n));
    t.rec('PoseidonT3 reduces inputs mod p: hash(c + p, x) = hash(c, x) (why THREAT-MODEL §8.5 asks for 0 < commitment < p)', red);
    // circuit side: disclose.wasm checks commitment = H(H(sk,vk),0) and tag = H(vk,nonce) — it only produces a witness
    // when circomlib's Poseidon inside the circuit equals the JS values.
    const dWasm = path.join(BUILD, 'disclose', 'disclose.wasm');
    let circOk = true;
    for (const [sk, vk, nonce] of [[0n, 0n, 0n], [1n, 1n, 1n], [P - 1n, P - 1n, P - 1n], [rnd(), rnd(), rnd()], [rnd(), rnd(), 0n]]) {
      try { await silently(() => witness(dWasm, { commitment: String(H(H(sk, vk), 0n)), disclosureTag: String(H(vk, nonce)), auditorNonce: String(nonce), spendKey: String(sk), viewKey: String(vk) })); }
      catch (e) { circOk = false; }
    }
    t.rec('circomlib Poseidon in disclose.wasm = poseidon-lite (5 vectors incl. 0 and p-1)', circOk);

    // ---- B. tree
    const ver5 = await ch.deploy(out.contracts['contracts/V5.sol'].WithdrawVerifierV5);
    const D = 10n ** 18n;
    const pool = await ch.deploy(out.contracts['contracts/Pool.sol'].LatheonShieldedPoolV7Native, [await ver5.getAddress(), D], libs);
    const z = L.zeros(LV);
    let zok = true; for (let i = 0; i <= LV; i++) if ((await pool.zeros(i)) !== z[i]) zok = false;
    t.rec('pool zeros[0..20] = JS (zeros[0] = 0, zeros[i+1] = H(zeros[i], zeros[i]))', zok);
    t.rec('empty-tree root (roots[0]) = zeros[20]', (await pool.roots(0)) === z[LV]);
    t.rec('isKnownRoot(0) is false', (await pool.isKnownRoot(0)) === false);
    const leaves = [];
    let rootsOk = true;
    for (let k = 0; k < 7; k++) {
      const c = note('split').commitment; leaves.push(c);
      await (await pool.deposit(c, { value: D })).wait();
      if ((await pool.roots(await pool.currentRootIndex())) !== L.tree(LV, leaves).root) rootsOk = false;
    }
    t.rec('incremental root after each of 7 deposits = full JS tree root', rootsOk);
    const src = fs.readFileSync(path.join(ROOT, 'contracts', 'LatheonShieldedPoolV7Native.sol'), 'utf8');
    t.rec('capacity guard: require(idx < 2 ** LEVELS) with LEVELS = 20 (static check)', /require\(idx < uint32\(2 \*\* LEVELS\), "Tree is full"\)/.test(src) && /LEVELS = 20;/.test(src));

    // ---- C. notes / nullifiers
    const v5 = files('withdraw_v5'); const vk5 = await vkeyOf('withdraw_v5');
    {
      const n = note('split');
      const map = new Map([[3, n.commitment]]);
      const hp = sparsePath(LV, map, 3);
      const a = await snarkjs.groth16.fullProve(inputFor('withdraw_v5', n, hp.root, hp, { recipient: 1n }), v5.wasm, v5.zkey);
      const alias = { ...n, spendKey: n.spendKey + P, viewKey: n.viewKey + P };
      let b = null, err = '';
      try { b = await snarkjs.groth16.fullProve(inputFor('withdraw_v5', alias, hp.root, hp, { recipient: 1n }), v5.wasm, v5.zkey); } catch (e) { err = e.message; }
      t.rec('spendKey/viewKey given as k + p: the circuit reduces them — same commitment and the SAME nullifierHash (no second nullifier for one note)',
        (b === null && /Assert|range|field/i.test(err)) || (b !== null && b.publicSignals[1] === a.publicSignals[1]), b ? 'nullifier ' + b.publicSignals[1].slice(0, 10) + '…' : 'refused: ' + err.slice(0, 40));
    }
    {
      // the same commitment deposited twice (leaves 7 and 8 of the pool above)
      const n = note('split');
      await (await pool.deposit(n.commitment, { value: D })).wait(); leaves.push(n.commitment);
      await (await pool.deposit(n.commitment, { value: D })).wait(); leaves.push(n.commitment);
      const map = new Map(leaves.map((c, i) => [i, c]));
      const root = await pool.roots(await pool.currentRootIndex());
      const p7 = sparsePath(LV, map, 7), p8 = sparsePath(LV, map, 8);
      const r1 = ch.signers[3].address || await ch.signers[3].getAddress();
      const A = await snarkjs.groth16.fullProve(inputFor('withdraw_v5', n, root, p7, { recipient: BigInt(r1) }), v5.wasm, v5.zkey);
      const B = await snarkjs.groth16.fullProve(inputFor('withdraw_v5', n, root, p8, { recipient: BigInt(r1) }), v5.wasm, v5.zkey);
      t.rec('same commitment at two leaves: both paths give the same nullifierHash', A.publicSignals[1] === B.publicSignals[1]);
      const sa = evm.sol(A.proof), sb = evm.sol(B.proof);
      await (await pool.withdraw(sa.a, sa.b, sa.c, root, n.nullifierHash, r1, evm.ethers.ZeroAddress, 0)).wait();
      let msg = ''; try { await pool.withdraw.staticCall(sb.a, sb.b, sb.c, root, n.nullifierHash, r1, evm.ethers.ZeroAddress, 0); } catch (e) { msg = e.reason || e.shortMessage || e.message; }
      t.rec('…the second withdrawal (other leaf) is refused: "Note already spent" (the duplicate deposit stays locked)', /already spent/.test(msg));
    }
    {
      const sk = rnd(); const n1 = { spendKey: sk, viewKey: rnd() }, n2 = { spendKey: sk, viewKey: rnd() };
      for (const n of [n1, n2]) { n.commitment = H(H(n.spendKey, n.viewKey), 0n); n.nullifierHash = H(sk, 1n); }
      t.rec('two notes with the same spendKey and different viewKeys share one nullifierHash (spendKey must be unique per note)', n1.commitment !== n2.commitment && n1.nullifierHash === n2.nullifierHash);
      const fixedVk = { spendKey: rnd(), viewKey: 1n };
      t.rec('design note: with viewKey = 1 the commitment would be H(nullifierHash, 0), i.e. computable from the public nullifier',
        H(H(fixedVk.spendKey, fixedVk.viewKey), 0n) === H(H(fixedVk.spendKey, 1n), 0n));
    }

    // ---- D. disclosure
    const dz = path.join(BUILD, 'disclose', 'disclose_final.zkey');
    const dvk = await snarkjs.zKey.exportVerificationKey(dz, quiet);
    const dver = await ch.deploy(out.contracts['contracts/D.sol'].Groth16Verifier);
    const n = note('split'); const nonce = rnd(); const tag = H(n.viewKey, nonce);
    const dinp = { commitment: String(n.commitment), disclosureTag: String(tag), auditorNonce: String(nonce), spendKey: String(n.spendKey), viewKey: String(n.viewKey) };
    const dp = await snarkjs.groth16.fullProve(dinp, dWasm, dz);
    const ds = evm.sol(dp.proof);
    const vsol = (ps) => dver.verifyProof(ds.a, ds.b, ds.c, ps);
    t.rec('disclose: honest proof verifies (snarkjs + DiscloseVerifier.sol); public = [commitment, tag, nonce]',
      (await verify(dvk, dp.publicSignals, dp.proof)) === true && (await vsol(dp.publicSignals)) === true && JSON.stringify(dp.publicSignals) === JSON.stringify([n.commitment, tag, nonce].map(String)));
    const other = rnd();
    t.rec('disclose: the same proof with another auditor nonce is rejected', (await verify(dvk, [dp.publicSignals[0], dp.publicSignals[1], String(other)], dp.proof)) === false && (await vsol([dp.publicSignals[0], dp.publicSignals[1], String(other)])) === false);
    t.rec('disclose: another nonce with a recomputed tag (needs viewKey) is rejected for this proof', (await vsol([dp.publicSignals[0], String(H(n.viewKey, other)), String(other)])) === false);
    const someoneElse = note('split');
    t.rec('disclose: the proof re-pointed to another commitment is rejected', (await vsol([String(someoneElse.commitment), dp.publicSignals[1], dp.publicSignals[2]])) === false);
    t.rec('disclose: nonce + p (non-canonical) is rejected by DiscloseVerifier.sol (checkField)', (await vsol([dp.publicSignals[0], dp.publicSignals[1], String(nonce + P)])) === false);
    let derr = '';
    try { await silently(() => snarkjs.groth16.fullProve({ ...dinp, commitment: String(someoneElse.commitment), disclosureTag: String(H(n.viewKey, nonce)) }, dWasm, dz)); } catch (e) { derr = String(e.message); }
    t.rec('disclose: the generator refuses to prove for someone else\'s commitment with my keys', /Assert Failed/.test(derr));
    let derr2 = '';
    try { await silently(() => snarkjs.groth16.fullProve({ ...dinp, spendKey: String(rnd()) }, dWasm, dz)); } catch (e) { derr2 = String(e.message); }
    t.rec('disclose: viewKey alone is not enough (wrong spendKey: refused)', /Assert Failed/.test(derr2));
    t.rec('disclose: the public tag is neither the nullifierHash nor the commitment of the note', tag !== n.nullifierHash && tag !== n.commitment);
    t.rec('disclose: two disclosures of one note to two auditors share only the commitment (tags differ)', H(n.viewKey, rnd()) !== tag);

    // ---- E. phase-2 contribution records in each final zkey (no ptau needed for this part)
    const bfu = L.dep('@iden3/binfileutils');
    for (const name of ['withdraw_v2', 'withdraw_v3', 'withdraw_v4', 'withdraw_v5', 'disclose']) {
      const z = path.join(BUILD, name, name + '_final.zkey');
      const hdr = await snarkjs.zKey.exportJson(z);   // header holds vk_delta_1 (the exported vk only has delta_2)
      const { fd, sections } = await bfu.readBinFile(z, 'zkey', 2);
      await bfu.startReadUniqueSection(fd, sections, 10);
      await fd.read(64);
      const nC = await fd.readULE32(); const names = []; let lastDelta = null;
      for (let i = 0; i < nC; i++) {
        const deltaAfter = await fd.read(64); await fd.read(64); await fd.read(64); await fd.read(128); await fd.read(64);
        const type = await fd.readULE32(); const plen = await fd.readULE32(); const pb = plen ? await fd.read(plen) : new Uint8Array();
        let nm = ''; if (pb[0] === 1) nm = Buffer.from(pb.slice(2, 2 + pb[1])).toString('utf8');
        names.push((type === 1 ? 'beacon:' : '') + (nm || '(no name)')); lastDelta = deltaAfter;
      }
      await bfu.endReadSection(fd); await fd.close();
      const curve = await snarkjs.curves.getCurveFromName('bn128');
      const d1 = lastDelta ? curve.G1.toObject(curve.G1.fromRprLEM(lastDelta, 0)).slice(0, 2).map(String) : ['', ''];
      t.rec(`${name}: zkey records ${nC} phase-2 contribution(s): ${names.join(', ')}; last recorded delta = the key's delta_1`,
        nC >= 1 && d1[0] === String(hdr.vk_delta_1[0]) && d1[1] === String(hdr.vk_delta_1[1]));
    }
    t.rec('no phase-1 ptau in the repository (snarkjs zkey verify cannot be run from the repo alone)',
      !require('child_process').execFileSync('git', ['-C', ROOT, 'ls-files'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().split('\n').some((f) => f.endsWith('.ptau')));
  } finally { ch.close(); }

  const fails = t.done();
  process.exitCode = fails ? 1 : 0;
  return fails;
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); }).then(() => process.exit(process.exitCode || 0));
module.exports = { main };
