'use strict';
/*
 * Groth16 proofs for withdraw_v5 (V7), withdraw_v4 (V6), withdraw_v3 (V5) and disclose, with snarkjs.
 *
 * snarkjs is an optional peer dependency: require it only when proving. Circuit artifacts (wasm + zkey, about 7 MB
 * for withdraw_v5) are not bundled; loadCircuit() takes them from a local directory (circuits/build/<name> in the
 * Latheon repository), from buffers, or downloads them from the pinned commit on jsDelivr, checking each file's
 * SHA-256 against the hash the demo publishes before use.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getAddress, ZeroAddress } = require('ethers');
const { CIRCUITS, PUBLIC_SIGNALS, circuitOf, levelsOf, feeVersion, FIELD_SIZE } = require('./constants');
const { computeNullifierHash, computeCommitment, computeDisclosureTag, isFieldElement } = require('./poseidon');

let snarkjsModule = null;
function snarkjs() {
  if (!snarkjsModule) {
    try { snarkjsModule = require('snarkjs'); }
    catch (e) { throw new Error('Proof generation needs snarkjs: npm install snarkjs@0.7.6 (' + e.message + ')'); }
  }
  return snarkjsModule;
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const circuitName = (kind) => (kind in CIRCUITS ? kind : circuitOf(kind));   // 'withdraw_v5' or a generation ('v7')

// Default local location: the Latheon repository checkout this package sits in (sdk/ next to circuits/).
const REPO_BUILD_DIR = path.resolve(__dirname, '..', '..', 'circuits', 'build');

/**
 * Loads a circuit's wasm and zkey.
 * @param {string} kind   'withdraw_v5' | 'withdraw_v4' | 'withdraw_v3' | 'disclose', or a generation 'v7' | 'v6' | 'v5'
 * @param {object} [opts]
 *   { wasm, zkey }        buffers or file paths, used as given
 *   { dir }               directory holding <name>.wasm and <name>_final.zkey (default: ../../circuits/build/<name> if present)
 *   { download: true }    fetch from the pinned commit on jsDelivr when no local files are found (Node 18+ fetch)
 *   { verify: false }     skip the SHA-256 check (only for circuits you built yourself)
 * @returns {Promise<{name: string, wasm: Uint8Array, zkey: Uint8Array}>}
 */
async function loadCircuit(kind, opts = {}) {
  const name = circuitName(kind);
  const spec = CIRCUITS[name];
  const verify = opts.verify !== false;
  const asBuf = async (x) => (typeof x === 'string' ? fs.promises.readFile(x) : x);
  let wasm, zkey, source;
  if (opts.wasm && opts.zkey) { wasm = await asBuf(opts.wasm); zkey = await asBuf(opts.zkey); source = 'given'; }
  else {
    const dir = opts.dir || path.join(REPO_BUILD_DIR, name);
    const wasmPath = path.join(dir, spec.wasm), zkeyPath = path.join(dir, spec.zkey);
    if (fs.existsSync(wasmPath) && fs.existsSync(zkeyPath)) { wasm = await fs.promises.readFile(wasmPath); zkey = await fs.promises.readFile(zkeyPath); source = dir; }
    else if (opts.download) { wasm = await download(spec.wasmUrl); zkey = await download(spec.zkeyUrl); source = spec.wasmUrl; }
    else throw new Error(`Circuit ${name} not found in ${dir}; pass { dir } or { wasm, zkey }, or { download: true } to fetch it from ${spec.wasmUrl}`);
  }
  wasm = new Uint8Array(wasm); zkey = new Uint8Array(zkey);
  if (verify) {
    if (sha256(wasm) !== spec.wasmSha256) throw new Error(`${name}.wasm does not match its published SHA-256; refusing to use it (${source})`);
    if (sha256(zkey) !== spec.zkeySha256) throw new Error(`${name} zkey does not match its published SHA-256; refusing to use it (${source})`);
  }
  return { name, wasm, zkey };
}
async function download(url) {
  if (typeof fetch !== 'function') throw new Error('fetch is not available: use Node 18+ or pass local circuit files');
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
  return new Uint8Array(await r.arrayBuffer());
}

const asField = (x, what) => { const v = BigInt(x); if (!isFieldElement(v)) throw new Error(what + ' is not a field element'); return v; };
const addrField = (a) => BigInt(getAddress(a));

/**
 * The circuit input of a withdrawal: the private note, its Merkle path, and the public bindings.
 * @param {object} p
 *   version        'v7' (default) | 'v6' | 'v5'
 *   spendKey, viewKey, pathElements, pathIndices, root   from the note and getProofInputsForCommitment()
 *   recipient      address paid DENOMINATION - fee
 *   relayer, fee   V6/V7 only: address paid `fee` (ZeroAddress and 0 when there is no relayer)
 * @returns {object} the input for snarkjs (every value a decimal string, as the demo builds it)
 */
function buildWithdrawInput(p) {
  const version = p.version || 'v7';
  const levels = levelsOf(version);
  if (!Array.isArray(p.pathElements) || p.pathElements.length !== levels) throw new Error(`pathElements must have ${levels} entries for ${version}`);
  if (!Array.isArray(p.pathIndices) || p.pathIndices.length !== levels) throw new Error(`pathIndices must have ${levels} entries for ${version}`);
  if (!p.pathIndices.every((b) => b === 0 || b === 1 || b === 0n || b === 1n || b === '0' || b === '1')) throw new Error('pathIndices must be bits');
  const spendKey = asField(p.spendKey, 'spendKey'), viewKey = asField(p.viewKey, 'viewKey');
  const root = asField(p.root, 'root');
  const nullifierHash = p.nullifierHash !== undefined ? asField(p.nullifierHash, 'nullifierHash') : computeNullifierHash(spendKey);
  if (nullifierHash !== computeNullifierHash(spendKey)) throw new Error('nullifierHash does not match spendKey');
  if (!p.recipient || getAddress(p.recipient) === ZeroAddress) throw new Error('recipient is required (the pool refuses the zero address)');
  const input = {
    root: root.toString(), nullifierHash: nullifierHash.toString(),
    spendKey: spendKey.toString(), viewKey: viewKey.toString(),
    pathElements: p.pathElements.map((x) => asField(x, 'pathElement').toString()),
    pathIndices: p.pathIndices.map((b) => Number(b)),
    recipient: addrField(p.recipient).toString(),
  };
  if (feeVersion(version)) {
    const relayer = p.relayer ? getAddress(p.relayer) : ZeroAddress;
    const fee = p.fee !== undefined ? BigInt(p.fee) : 0n;
    if (fee < 0n || fee >= FIELD_SIZE) throw new Error('fee out of range');
    if (fee > 0n && relayer === ZeroAddress) throw new Error('A fee needs a relayer address (the pool refuses "Fee without relayer")');
    input.relayer = BigInt(relayer).toString();
    input.fee = fee.toString();
  } else if ((p.relayer && getAddress(p.relayer) !== ZeroAddress) || (p.fee !== undefined && BigInt(p.fee) !== 0n)) {
    throw new Error('V5 proofs have no relayer or fee');
  }
  return input;
}

/** snarkjs's exportSolidityCallData string -> { pA, pB, pC, pubSignals } (0x-hex strings, as the contracts and the relayer take them; compare with BigInt()). */
async function toCallData(proof, publicSignals) {
  const [pA, pB, pC, pubSignals] = JSON.parse('[' + (await snarkjs().groth16.exportSolidityCallData(proof, publicSignals)) + ']');
  return { pA, pB, pC, pubSignals };
}

/**
 * Makes a withdrawal proof.
 * @param {object} input     from buildWithdrawInput()
 * @param {object} circuit   from loadCircuit() (its name must match the input's generation)
 * @returns {Promise<{pA, pB, pC, pubSignals, proof, publicSignals, version}>}
 */
async function proveWithdraw(input, circuit) {
  const version = input.relayer !== undefined ? (circuit.name === 'withdraw_v4' ? 'v6' : 'v7') : 'v5';
  const expected = input.relayer !== undefined ? ['withdraw_v5', 'withdraw_v4'] : ['withdraw_v3'];
  if (!expected.includes(circuit.name)) throw new Error(`Circuit ${circuit.name} does not fit this input (${expected.join(' or ')})`);
  if (input.pathElements.length !== levelsOf(version === 'v5' ? 'v5' : 'v7')) throw new Error('path depth does not match the circuit');
  const { proof, publicSignals } = await snarkjs().groth16.fullProve(input, circuit.wasm, circuit.zkey);
  const cd = await toCallData(proof, publicSignals);
  checkWithdrawBinding(cd.pubSignals, input, circuit.name);
  return Object.assign(cd, { proof, publicSignals, version });
}

/** Throws unless the public signals of a proof carry exactly the bindings of `input` (recipient, relayer, fee, root, nullifier). */
function checkWithdrawBinding(pubSignals, input, circuitName) {
  const names = PUBLIC_SIGNALS[circuitName];
  if (!names) throw new Error('Unknown circuit ' + circuitName);
  if (pubSignals.length !== names.length) throw new Error(`Expected ${names.length} public signals, got ${pubSignals.length}`);
  names.forEach((n, i) => { if (BigInt(pubSignals[i]) !== BigInt(input[n])) throw new Error(`Public signal ${n} is not bound as requested`); });
}

/** The verification key of a loaded circuit, exported from its zkey (what verification_key.json holds). */
async function verificationKeyOf(circuit) {
  if (!circuit.vkey) circuit.vkey = await snarkjs().zKey.exportVerificationKey(circuit.zkey);
  return circuit.vkey;
}

/**
 * Verifies a proof locally: `key` is a verification key (object or JSON path) or a loadCircuit() result (the key is
 * then exported from its zkey). The on-chain verifier does the same check; see pool.verifyOnChain().
 */
async function verifyProofLocally(key, proofResult) {
  const vk = typeof key === 'string' ? JSON.parse(await fs.promises.readFile(key, 'utf8')) : key.zkey ? await verificationKeyOf(key) : key;
  return snarkjs().groth16.verify(vk, proofResult.publicSignals, proofResult.proof);
}

/** Circuit input of a disclosure: proves that `commitment` belongs to the holder of viewKey, tagged for one auditor code. */
function buildDiscloseInput({ spendKey, viewKey, auditorNonce }) {
  const sk = asField(spendKey, 'spendKey'), vk = asField(viewKey, 'viewKey'), nonce = asField(auditorNonce, 'auditorNonce');
  return { commitment: computeCommitment(sk, vk).toString(), disclosureTag: computeDisclosureTag(vk, nonce).toString(), auditorNonce: nonce.toString(), spendKey: sk.toString(), viewKey: vk.toString() };
}

/** Makes a disclosure proof: { pA, pB, pC, pubSignals: [commitment, disclosureTag, auditorNonce], proof, publicSignals }. */
async function proveDisclose(input, circuit) {
  if (circuit.name !== 'disclose') throw new Error('Circuit ' + circuit.name + ' is not the disclose circuit');
  const { proof, publicSignals } = await snarkjs().groth16.fullProve(input, circuit.wasm, circuit.zkey);
  const cd = await toCallData(proof, publicSignals);
  PUBLIC_SIGNALS.disclose.forEach((n, i) => { if (BigInt(cd.pubSignals[i]) !== BigInt(input[n])) throw new Error(`Public signal ${n} is not bound as requested`); });
  return Object.assign(cd, { proof, publicSignals });
}

module.exports = { loadCircuit, buildWithdrawInput, proveWithdraw, checkWithdrawBinding, verificationKeyOf, verifyProofLocally, buildDiscloseInput, proveDisclose, toCallData, REPO_BUILD_DIR };
