'use strict';
/*
 * Shared helpers for the internal ZK review tests (test/zk-review). Not an audit.
 * Everything runs locally: snarkjs proofs against the committed circuit files, and (for the contract checks) a
 * throw-away ganache EVM in this process. Nothing here talks to a live network.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Dependencies come from test/native/node_modules (as test/native-v7 does) unless installed here.
const NM_LOCAL = path.join(__dirname, 'node_modules');
const NM_NATIVE = path.resolve(__dirname, '..', 'native', 'node_modules');
function dep(name) {
  for (const base of [NM_LOCAL, NM_NATIVE]) {
    const p = path.join(base, name);
    if (fs.existsSync(p)) return require(p);
  }
  throw new Error('missing dependency ' + name + ' — run: cd test/native && npm install');
}
const snarkjs = dep('snarkjs');
const { poseidon2 } = dep('poseidon-lite');

const ROOT = path.resolve(__dirname, '..', '..');
const BUILD = path.join(ROOT, 'circuits', 'build');
const P = 21888242871839275222246405745257275088548364400416034343698204186575808495617n; // BN254 scalar field
const mod = (x) => ((x % P) + P) % P;
const H = (a, b) => poseidon2([mod(BigInt(a)), mod(BigInt(b))]);
const rnd = () => BigInt('0x' + crypto.randomBytes(31).toString('hex')) % P;
function inv(a) { // modular inverse by Fermat
  let r = 1n, b = mod(a), e = P - 2n;
  while (e > 0n) { if (e & 1n) r = (r * b) % P; b = (b * b) % P; e >>= 1n; }
  return r;
}

// Circuit table: which files, depth and public inputs each generation has.
const CIRCUITS = {
  withdraw:    { levels: 8,  pub: ['root', 'nullifierHash'], secret: 'single' },              // no zkey in the repository
  withdraw_v2: { levels: 8,  pub: ['root', 'nullifierHash'], secret: 'split' },
  withdraw_v3: { levels: 8,  pub: ['root', 'nullifierHash', 'recipient'], secret: 'split' },
  withdraw_v4: { levels: 20, pub: ['root', 'nullifierHash', 'recipient', 'relayer', 'fee'], secret: 'split' },
  withdraw_v5: { levels: 20, pub: ['root', 'nullifierHash', 'recipient', 'relayer', 'fee'], secret: 'split' },
};
const files = (name) => ({
  wasm: path.join(BUILD, name, name + '.wasm'),
  zkey: path.join(BUILD, name, name + '_final.zkey'),
  vkeyFile: path.join(BUILD, name, 'verification_key.json'),
});

// A note in the circuit's format.
function note(kind) {
  if (kind === 'single') { const secret = rnd(); return { secret, commitment: H(secret, 0n), nullifierHash: H(secret, 1n) }; }
  const spendKey = rnd(), viewKey = rnd();
  return { spendKey, viewKey, commitment: H(H(spendKey, viewKey), 0n), nullifierHash: H(spendKey, 1n) };
}

// Incremental Merkle tree exactly as the pools build it (zeros[0] = 0, zeros[i+1] = H(zeros[i], zeros[i])).
function zeros(levels) { const z = [0n]; for (let i = 0; i < levels; i++) z.push(H(z[i], z[i])); return z; }
function tree(levels, leaves) {
  const z = zeros(levels);
  const layers = [leaves.slice()];
  for (let l = 0; l < levels; l++) {
    const cur = layers[l], up = [];
    for (let j = 0; j < Math.max(1, Math.ceil(cur.length / 2)); j++) up.push(H(cur[2 * j] ?? z[l], cur[2 * j + 1] ?? z[l]));
    layers.push(up);
  }
  return { root: layers[levels][0], layers, z };
}
// Honest path for leaf `index` in a sparse tree given as {index -> leaf} (works for depth 20 and index 2^20-1).
function sparsePath(levels, leafMap, index) {
  const z = zeros(levels);
  let level = new Map(leafMap);
  const pathElements = [], pathIndices = [];
  let idx = index;
  for (let l = 0; l < levels; l++) {
    const sib = idx ^ 1;
    pathElements.push(level.has(sib) ? level.get(sib) : z[l]);
    pathIndices.push(idx & 1);
    const up = new Map();
    for (const k of level.keys()) {
      const p = k >> 1;
      if (up.has(p)) continue;
      up.set(p, H(level.get(2 * p) ?? z[l], level.get(2 * p + 1) ?? z[l]));
    }
    level = up; idx >>= 1;
  }
  return { root: level.get(0), pathElements, pathIndices };
}

// THE FORGERY (THREAT-MODEL §8.0): a path for a commitment that is NOT in the tree, which reaches `root = H(L, R)`
// by using a non-binary selector at the top level. MultiMux1: out0 = (pe - lh) * s + lh, out1 = (lh - pe) * s + pe.
// Choose pe = L + R - lh and s = (L - lh) / (pe - lh): then out0 = L, out1 = R.
function forgePath(levels, leaf, L, R) {
  const pathElements = [], pathIndices = [];
  let lh = leaf;
  for (let i = 0; i < levels - 1; i++) { const pe = rnd(); pathElements.push(pe); pathIndices.push(0n); lh = H(lh, pe); }
  const pe = mod(L + R - lh);
  const s = mod((L - lh) * inv(pe - lh));
  pathElements.push(pe); pathIndices.push(s);
  return { pathElements, pathIndices, topSelector: s };
}

function inputFor(name, n, root, path_, extra = {}) {
  const c = CIRCUITS[name];
  const inp = { root, nullifierHash: n.nullifierHash };
  if (c.pub.includes('recipient')) inp.recipient = extra.recipient ?? 0n;
  if (c.pub.includes('relayer')) inp.relayer = extra.relayer ?? 0n;
  if (c.pub.includes('fee')) inp.fee = extra.fee ?? 0n;
  if (c.secret === 'single') inp.secret = n.secret; else { inp.spendKey = n.spendKey; inp.viewKey = n.viewKey; }
  inp.pathElements = path_.pathElements; inp.pathIndices = path_.pathIndices;
  return JSON.parse(JSON.stringify(inp, (k, v) => (typeof v === 'bigint' ? v.toString() : v)));
}

// Witness with a given wasm, then prove with a given zkey (skips nothing: snarkjs' prover does not check the witness).
async function witness(wasm, input) {
  const wtns = { type: 'mem' };
  await snarkjs.wtns.calculate(input, wasm, wtns);
  return wtns;
}
async function proveWtns(zkey, wtns) { return snarkjs.groth16.prove(zkey, wtns); }
async function verify(vkey, pub, proof) {
  try { return await snarkjs.groth16.verify(vkey, pub, proof, { info() {}, warn() {}, error() {}, debug() {} }); }
  catch (e) { return 'error: ' + e.message; }
}
const vkeyOf = async (name) => {
  const f = files(name);
  if (fs.existsSync(f.vkeyFile)) return JSON.parse(fs.readFileSync(f.vkeyFile, 'utf8'));
  return snarkjs.zKey.exportVerificationKey(f.zkey);
};
const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

// The circom witness calculator prints its assert errors to the console; expected failures are run silently.
async function silently(fn) { const e = console.error, l = console.log; console.error = () => {}; console.log = () => {}; try { return await fn(); } finally { console.error = e; console.log = l; } }

// Tiny check recorder shared by every test file.
function recorder(title) {
  const res = [];
  console.log('\n=== ' + title);
  return {
    rec(name, ok, note) { res.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (note ? '   [' + note + ']' : '')); },
    skip(name, why) { res.push({ name, ok: true, skipped: true }); console.log('SKIP ' + name + '   [' + why + ']'); },
    done() { const f = res.filter((r) => !r.ok).length; console.log('--- ' + title + ': ' + (res.length - f) + '/' + res.length + ' passed' + (res.some((r) => r.skipped) ? ' (' + res.filter((r) => r.skipped).length + ' skipped)' : '')); return f; },
  };
}

module.exports = { dep, snarkjs, poseidon2, ROOT, BUILD, P, mod, H, rnd, inv, CIRCUITS, files, note, zeros, tree, sparsePath,
  forgePath, inputFor, witness, proveWtns, verify, vkeyOf, sha256, recorder, silently };
