'use strict';
// Tests for the V8 circuits: circuits/withdraw_v6.circom, disclose_v2.circom, disclose_link.circom.
// Builds them from source with circom 2.2.3 ($CIRCOM) and circomlib 2.0.5, makes THROWAWAY Groth16 keys from
// circuits/ptau/pot14_final.ptau (single party, no contribution: for tests only, deleted afterwards), and checks
// real proofs. Internal tests, not an audit. Nothing talks to a network.
//
//   cd test/circuits-v8 && npm install && CIRCOM=/path/to/circom-2.2.3 npm test
//
// Exit code 0 means every check passed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const snarkjs = require('snarkjs');
const { poseidon2, poseidon3 } = require('poseidon-lite');
const { keccak256, toUtf8Bytes, AbiCoder, getAddress } = require('ethers');

const ROOT = path.resolve(__dirname, '..', '..');
const P = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const LEVELS = 20;
const PTAU = path.join(ROOT, 'circuits', 'ptau', 'pot14_final.ptau');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'latheon-circuits-v8-'));

let failures = 0, passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; console.log('  ok   ' + name); }
  else { failures++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}
const NOLOG = { info() {}, warn() {}, error() {}, debug() {} };
async function quiet(fn) { const e = console.error, l = console.log; console.error = () => {}; console.log = () => {}; try { return await fn(); } finally { console.error = e; console.log = l; } }

// ---- reference implementation (what the SDK and the contracts must compute) ----
const tagOf = (s) => BigInt(keccak256(toUtf8Bytes(s))) % P;
const TAG = { COMMIT: tagOf('latheon.v8.commit'), NULL: tagOf('latheon.v8.null'), DISC: tagOf('latheon.v8.disc') };
const commitmentOf = (s, v) => poseidon3([TAG.COMMIT, s, v]);
const nullifierOf = (s, ctx) => poseidon3([TAG.NULL, s, ctx]);
const discTagOf = (v, nonce) => poseidon3([TAG.DISC, v, nonce]);
const abi = AbiCoder.defaultAbiCoder();
// ctx = keccak256(abi.encode("latheon.v8.ctx", chainId, pool)) mod p (docs/v8-design.md §3)
const ctxOf = (chainId, pool) => BigInt(keccak256(abi.encode(['string', 'uint256', 'address'], ['latheon.v8.ctx', chainId, pool]))) % P;
// extDataHash = keccak256(abi.encode(recipient, relayer, fee, reference, destChainId)) mod p (§7)
const extOf = (e) => BigInt(keccak256(abi.encode(['address', 'address', 'uint256', 'bytes32', 'uint256'], [e.recipient, e.relayer, e.fee, e.reference, e.destChainId]))) % P;
const rnd = () => BigInt(keccak256(toUtf8Bytes(Math.random().toString() + Date.now() + process.hrtime.bigint()))) % P;

// Sparse tree with standard Poseidon(l, r) nodes and zero leaves = 0, as the V7 pools.
function zeros() { const z = [0n]; for (let i = 0; i < LEVELS; i++) z.push(poseidon2([z[i], z[i]])); return z; }
const Z = zeros();
function treeWith(leaves) { // leaves: array, index = position
  let layer = new Map(leaves.map((l, i) => [i, l]));
  const layers = [layer];
  for (let lv = 0; lv < LEVELS; lv++) {
    const next = new Map();
    for (const idx of layer.keys()) {
      const p = idx >> 1; if (next.has(p)) continue;
      const l = layer.has(2 * p) ? layer.get(2 * p) : Z[lv];
      const r = layer.has(2 * p + 1) ? layer.get(2 * p + 1) : Z[lv];
      next.set(p, poseidon2([l, r]));
    }
    layers.push(next); layer = next;
  }
  const root = layer.get(0);
  const pathOf = (index) => {
    const pe = [], pi = [];
    let idx = index;
    for (let lv = 0; lv < LEVELS; lv++) {
      const sib = idx ^ 1;
      pe.push(layers[lv].has(sib) ? layers[lv].get(sib) : Z[lv]);
      pi.push(BigInt(idx & 1));
      idx >>= 1;
    }
    return { pathElements: pe, pathIndices: pi };
  };
  return { root, pathOf };
}

// ---- build ----
function circomlibDir() {
  const d = path.join(__dirname, 'node_modules', 'circomlib', 'circuits');
  if (!fs.existsSync(d)) throw new Error('circomlib not installed: run npm install in test/circuits-v8');
  return d;
}
function build(file, srcDir = path.join(ROOT, 'circuits')) {
  const lib = path.join(OUT, 'lib');
  fs.mkdirSync(lib, { recursive: true });
  if (!fs.existsSync(path.join(lib, 'circomlib'))) fs.symlinkSync(circomlibDir(), path.join(lib, 'circomlib'));
  const out = execFileSync(process.env.CIRCOM, [path.join(srcDir, file + '.circom'), '--r1cs', '--wasm', '--sym', '-l', lib, '-l', path.join(ROOT, 'circuits'), '-o', OUT], { encoding: 'utf8' });
  const n = (re) => Number((out.match(re) || [])[1]);
  return {
    name: file, r1cs: path.join(OUT, file + '.r1cs'), wasm: path.join(OUT, file + '_js', file + '.wasm'), sym: path.join(OUT, file + '.sym'),
    nonLinear: n(/non-linear constraints: (\d+)/), linear: n(/^linear constraints: (\d+)/m), nPublic: n(/public inputs: (\d+)/),
  };
}
async function keys(c) {
  c.zkey = path.join(OUT, c.name + '.zkey');
  await quiet(() => snarkjs.zKey.newZKey(c.r1cs, PTAU, c.zkey));
  c.vkey = await snarkjs.zKey.exportVerificationKey(c.zkey);
  return c;
}
async function prove(c, input) { return quiet(() => snarkjs.groth16.fullProve(input, c.wasm, c.zkey)); }
async function verify(c, pub, proof) { return quiet(() => snarkjs.groth16.verify(c.vkey, pub.map(String), proof)); }
async function witnessFails(c, input) {
  try { await quiet(() => snarkjs.wtns.calculate(input, c.wasm, { type: 'mem' })); return false; } catch (e) { return true; }
}
// every public signal changed by +1 and to 0 must be rejected
async function alteredRejected(c, pub, proof, names) {
  let all = true; const bad = [];
  for (let i = 0; i < pub.length; i++) {
    for (const alt of [(BigInt(pub[i]) + 1n) % P, BigInt(pub[i]) === 0n ? 1n : 0n]) {
      const p2 = pub.slice(); p2[i] = alt.toString();
      if (await verify(c, p2, proof)) { all = false; bad.push(names[i] + '→' + alt); }
    }
  }
  return { all, bad };
}

(async () => {
  if (!process.env.CIRCOM || !fs.existsSync(process.env.CIRCOM)) { console.error('Set CIRCOM to the circom 2.2.3 binary.'); process.exit(2); }
  const ver = execFileSync(process.env.CIRCOM, ['--version'], { encoding: 'utf8' }).trim();
  console.log(ver + ', circomlib 2.0.5, snarkjs ' + JSON.parse(fs.readFileSync(path.join(__dirname, 'node_modules', 'snarkjs', 'package.json'), 'utf8')).version + ', node ' + process.version);

  console.log('\n[tags] domain tags in circuits/latheon_v8.circom = keccak256(string) mod p');
  const src = fs.readFileSync(path.join(ROOT, 'circuits', 'latheon_v8.circom'), 'utf8');
  for (const [fn, s, v] of [['TAG_COMMIT', 'latheon.v8.commit', TAG.COMMIT], ['TAG_NULL', 'latheon.v8.null', TAG.NULL], ['TAG_DISC', 'latheon.v8.disc', TAG.DISC]]) {
    const m = src.match(new RegExp('function ' + fn + '\\(\\) \\{ return (\\d+); \\}'));
    check(fn + ' = keccak256("' + s + '") mod p', m && BigInt(m[1]) === v, m && m[1]);
  }
  check('the three tags differ', new Set([TAG.COMMIT, TAG.NULL, TAG.DISC].map(String)).size === 3);

  console.log('\n[build] compile and throwaway keys');
  const W = await keys(build('withdraw_v6'));
  const D = await keys(build('disclose_v2'));
  const L = await keys(build('disclose_link'));
  for (const c of [W, D, L]) console.log(`  ${c.name}: ${c.nonLinear + c.linear} constraints (${c.nonLinear} non-linear, ${c.linear} linear), ${c.nPublic} public inputs`);
  check('withdraw_v6 has 4 public inputs (root, nullifierHash, ctx, extDataHash)', W.nPublic === 4 && W.vkey.nPublic === 4);
  check('disclose_v2 has 3 public inputs', D.nPublic === 3 && D.vkey.nPublic === 3);
  check('disclose_link has 5 public inputs', L.nPublic === 5 && L.vkey.nPublic === 5);

  // a pool with a few deposits; our note at index 5 (path selectors 1,0,1,0,…)
  const chainId = 60531373273n;
  const poolA = getAddress('0x' + '11'.repeat(20)), poolB = getAddress('0x' + '22'.repeat(20));
  const ctxA = ctxOf(chainId, poolA), ctxB = ctxOf(chainId, poolB), ctxOtherChain = ctxOf(421614n, poolA);
  const s = rnd(), v = rnd();
  const C = commitmentOf(s, v);
  const leaves = [rnd(), rnd(), rnd(), rnd(), rnd(), C, rnd()];
  const T = treeWith(leaves);
  const pth = T.pathOf(5);
  const ext = { recipient: getAddress('0x' + 'ab'.repeat(20)), relayer: getAddress('0x' + 'cd'.repeat(20)), fee: 25n * 10n ** 16n, reference: keccak256(toUtf8Bytes('invoice-42|salt')), destChainId: chainId };
  const extHash = extOf(ext);
  const wInput = (o = {}) => ({ root: T.root, nullifierHash: nullifierOf(s, ctxA), ctx: ctxA, extDataHash: extHash, spendKey: s, viewKey: v, pathElements: pth.pathElements, pathIndices: pth.pathIndices, ...o });

  console.log('\n[withdraw_v6] honest proof');
  const t0 = Date.now();
  const wp = await prove(W, wInput());
  console.log('  first proof ' + (Date.now() - t0) + ' ms');
  check('honest proof verifies', await verify(W, wp.publicSignals, wp.proof));
  check('public signals are [root, nullifierHash, ctx, extDataHash]', wp.publicSignals.map(BigInt).join() === [T.root, nullifierOf(s, ctxA), ctxA, extHash].join());

  console.log('\n[withdraw_v6] the proof cannot be reused with other public inputs');
  const r1 = await alteredRejected(W, wp.publicSignals, wp.proof, ['root', 'nullifierHash', 'ctx', 'extDataHash']);
  check('each public input +1 or set to 0: rejected', r1.all, r1.bad.join(', '));
  const swap = (i, val) => { const p2 = wp.publicSignals.slice(); p2[i] = String(val); return p2; };
  check('same proof presented to pool B (other ctx): rejected', !(await verify(W, swap(2, ctxB), wp.proof)));
  check('same proof presented on another chain (other ctx): rejected', !(await verify(W, swap(2, ctxOtherChain), wp.proof)));
  for (const [label, e] of [['recipient', { ...ext, recipient: getAddress('0x' + 'ee'.repeat(20)) }], ['relayer', { ...ext, relayer: getAddress('0x' + 'ff'.repeat(20)) }],
    ['fee +1 wei', { ...ext, fee: ext.fee + 1n }], ['fee 0', { ...ext, fee: 0n }], ['reference', { ...ext, reference: keccak256(toUtf8Bytes('invoice-43|salt')) }],
    ['destChainId', { ...ext, destChainId: 421614n }], ['recipient and relayer swapped', { ...ext, recipient: ext.relayer, relayer: ext.recipient }]]) {
    check('extData with other ' + label + ': rejected', !(await verify(W, swap(3, extOf(e)), wp.proof)));
  }

  console.log('\n[withdraw_v6] the witness generator refuses false statements');
  check('nullifier of pool B with ctx of pool A', await witnessFails(W, wInput({ nullifierHash: nullifierOf(s, ctxB) })));
  check('nullifier of another spendKey', await witnessFails(W, wInput({ nullifierHash: nullifierOf(rnd(), ctxA) })));
  check('wrong viewKey (commitment not in the tree)', await witnessFails(W, wInput({ viewKey: v + 1n })));
  check('V7-style commitment Poseidon(Poseidon(s,v),0) in the tree', await (async () => {
    const t7 = treeWith([poseidon2([poseidon2([s, v]), 0n])]); const p7 = t7.pathOf(0);
    return witnessFails(W, wInput({ root: t7.root, pathElements: p7.pathElements, pathIndices: p7.pathIndices }));
  })());
  check('root of another tree', await witnessFails(W, wInput({ root: treeWith([rnd()]).root })));
  // nullifiers of one note differ between pools and chains
  check('one note, three contexts: three different nullifiers', new Set([nullifierOf(s, ctxA), nullifierOf(s, ctxB), nullifierOf(s, ctxOtherChain)].map(String)).size === 3);

  console.log('\n[withdraw_v6] path selectors must be bits (the V7 fix kept)');
  // A copy of withdraw_v6 without the bit check, built only here, makes the forged witness; the real circuit's r1cs must refuse it.
  const noBitDir = path.join(OUT, 'nobit'); fs.mkdirSync(noBitDir, { recursive: true });
  fs.writeFileSync(path.join(noBitDir, 'latheon_v8.circom'), src.replace('pathIndices[i] * (1 - pathIndices[i]) === 0;', '// bit check removed for the test'));
  fs.writeFileSync(path.join(noBitDir, 'withdraw_v6_nobit.circom'), fs.readFileSync(path.join(ROOT, 'circuits', 'withdraw_v6.circom'), 'utf8'));
  const NB = build('withdraw_v6_nobit', noBitDir);
  const symBody = (f) => fs.readFileSync(f, 'utf8').split('\n').map((l) => l.split(',').slice(0, 2).concat(l.split(',').slice(3)).join(',')).join('\n');
  check('the copy without the bit check has the same wires as withdraw_v6', symBody(NB.sym) === symBody(W.sym));
  check('withdraw_v6 has 20 more constraints than the copy (one bit check per level)', (W.nonLinear + W.linear) - (NB.nonLinear + NB.linear) === 20, `${W.nonLinear + W.linear} vs ${NB.nonLinear + NB.linear}`);
  // forge: a note never deposited, selector s on level `lv`; MultiMux1 gives out0 = (c1-c0)*s + c0, out1 = (c0-c1)*s + c1
  const forged = (lv, sel) => {
    const fs_ = rnd(), fv = rnd(); let h = commitmentOf(fs_, fv);
    const pe = [], pi = [];
    for (let i = 0; i < LEVELS; i++) {
      const sib = rnd(); const si = i === lv ? sel : 0n;
      const o0 = ((((sib - h) % P + P) % P) * si + h) % P;
      const o1 = ((((h - sib) % P + P) % P) * si + sib) % P;
      pe.push(sib); pi.push(si); h = poseidon2([o0, o1]);
    }
    return { root: h, nullifierHash: nullifierOf(fs_, ctxA), ctx: ctxA, extDataHash: extHash, spendKey: fs_, viewKey: fv, pathElements: pe, pathIndices: pi };
  };
  let wgRefused = true, r1csRefused = true, nobitAccepts = true;
  for (const lv of [0, 9, 19]) for (const sel of [2n, P - 1n, (P + 1n) / 2n]) {
    const inp = forged(lv, sel);
    if (!(await witnessFails(W, inp))) wgRefused = false;
    const wt = path.join(OUT, `forged_${lv}.wtns`);
    await quiet(() => snarkjs.wtns.calculate(inp, NB.wasm, wt));
    if (!(await quiet(() => snarkjs.wtns.check(NB.r1cs, wt, NOLOG)))) nobitAccepts = false;
    if (await quiet(() => snarkjs.wtns.check(W.r1cs, wt, NOLOG))) r1csRefused = false;
  }
  check('selector 2, p−1, (p+1)/2 on levels 0, 9, 19: witness generator refuses', wgRefused);
  check('control: the same forged witnesses satisfy the copy without the bit check', nobitAccepts);
  check('the same forged witnesses do not satisfy the withdraw_v6 r1cs', r1csRefused);

  console.log('\n[disclose_v2] one deposit, one auditor code, no nullifier');
  const nonce = 777888999n;
  const dIn = (o = {}) => ({ commitment: C, disclosureTag: discTagOf(v, nonce), auditorNonce: nonce, spendKey: s, viewKey: v, ...o });
  const dp = await prove(D, dIn());
  check('honest proof verifies', await verify(D, dp.publicSignals, dp.proof));
  check('public signals are [commitment, disclosureTag, auditorNonce] — no nullifier', dp.publicSignals.map(BigInt).join() === [C, discTagOf(v, nonce), nonce].join());
  const r2 = await alteredRejected(D, dp.publicSignals, dp.proof, ['commitment', 'disclosureTag', 'auditorNonce']);
  check('each public input +1 or set to 0: rejected', r2.all, r2.bad.join(', '));
  check('another auditor\'s code with the tag of this one: witness refused', await witnessFails(D, dIn({ auditorNonce: nonce + 1n })));
  check('commitment of another note: witness refused', await witnessFails(D, dIn({ commitment: commitmentOf(rnd(), v) })));
  check('tag made with another viewKey: witness refused', await witnessFails(D, dIn({ disclosureTag: discTagOf(v + 1n, nonce) })));

  console.log('\n[disclose_link] commitment and nullifier of one note in one pool');
  const lIn = (o = {}) => ({ commitment: C, nullifierHash: nullifierOf(s, ctxA), ctx: ctxA, auditorNonce: nonce, disclosureTag: discTagOf(v, nonce), spendKey: s, viewKey: v, ...o });
  const lp = await prove(L, lIn());
  check('honest proof verifies', await verify(L, lp.publicSignals, lp.proof));
  check('its nullifier is the one withdraw_v6 publishes for the same note and pool', BigInt(lp.publicSignals[1]) === BigInt(wp.publicSignals[1]));
  const r3 = await alteredRejected(L, lp.publicSignals, lp.proof, ['commitment', 'nullifierHash', 'ctx', 'auditorNonce', 'disclosureTag']);
  check('each public input +1 or set to 0: rejected', r3.all, r3.bad.join(', '));
  check('nullifier of pool B claimed for pool A: witness refused', await witnessFails(L, lIn({ nullifierHash: nullifierOf(s, ctxB) })));
  check('nullifier of another note: witness refused', await witnessFails(L, lIn({ nullifierHash: nullifierOf(rnd(), ctxA) })));
  check('commitment of another note: witness refused', await witnessFails(L, lIn({ commitment: commitmentOf(rnd(), rnd()) })));
  check('wrong auditor code: witness refused', await witnessFails(L, lIn({ auditorNonce: nonce + 1n })));
  check('a disclose_link proof is not a disclose_v2 proof (other key)', !(await verify(D, [lp.publicSignals[0], lp.publicSignals[4], lp.publicSignals[3]], lp.proof)));

  console.log('\n[timing] median of 3 proofs after the one above, this machine');
  const timing = {};
  for (const [c, inp] of [[W, wInput()], [D, dIn()], [L, lIn()]]) {
    const t = [];
    for (let i = 0; i < 3; i++) { const a = Date.now(); await prove(c, inp); t.push(Date.now() - a); }
    t.sort((a, b) => a - b); timing[c.name] = t[1];
    console.log(`  ${c.name}: ${t[1]} ms (runs ${t.join(', ')})`);
  }
  console.log(`  machine: ${os.cpus().length} × ${os.cpus()[0].model}`);

  fs.rmSync(OUT, { recursive: true, force: true });
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); try { fs.rmSync(OUT, { recursive: true, force: true }); } catch (_) {} process.exit(1); });
