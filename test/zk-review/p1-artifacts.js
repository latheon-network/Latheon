'use strict';
/*
 * P1.4 — artifact consistency. Internal review, not an audit. Local only (git and files; no network).
 *   - sha256 of the committed wasm/zkey = docs/dev-ceremony-v3/v4/v5.md (and, if the l2-eval-ci checkout is found,
 *     = the hashes recorded in testnet/latheon/artifacts/latheon-testnet.json, which the test chain deploy uses)
 *   - verification_key.json = vk exported from the final zkey = the constants in the Solidity verifier
 *   - public input order: circuit `main {public [...]}` = verifier IC count = the pubSignals array built by every pool
 *   - zkey header (nPublic, nVars, constraints) and its A/B coefficient matrices = the r1cs built from source ($CIRCOM)
 *   - fresh circom 2.2.3 build (circomlib 2.0.5; withdraw_v2/disclose: 2.0.2 --O1) reproduces the committed wasm byte for byte ($CIRCOM)
 *   - contracts and circuits at the deployed commit 129a4c0 = HEAD; solc 0.8.37 bytecode of the verifiers/pools built
 *     here = the bytecode in the l2-eval-ci artifact (if found)
 * What this CANNOT check: the C-matrix-dependent points (C/L section, IC) and the H points against the circuit — that
 * needs the phase-1 ptau, which is not in the repository (snarkjs zkey verify). See README.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const L = require('./lib');
const { snarkjs, ROOT, BUILD, sha256, recorder } = L;
const evm = require('./evm');
const circom = require('./circom');
const quiet = { info() {}, warn() {}, error() {}, debug() {} };

const DEPLOYED = '129a4c0d38af03b0ad2db59e8ad01823e813ed77';
const L2 = process.env.L2_EVAL_CI || path.resolve(ROOT, '..', 'l2-eval-ci');
const ART = path.join(L2, 'testnet', 'latheon', 'artifacts', 'latheon-testnet.json');

function solConstants(file) {
  const src = fs.readFileSync(path.join(ROOT, 'contracts', file), 'utf8');
  const m = {}; for (const x of src.matchAll(/uint256 constant (\w+)\s*=\s*(\d+);/g)) m[x[1]] = x[2];
  const n = (src.match(/uint\[(\d+)\] calldata _pubSignals/) || [])[1];
  return { m, nPub: Number(n) };
}
function vkMatchesSol(vk, file) {
  const { m, nPub } = solConstants(file);
  const want = { alphax: vk.vk_alpha_1[0], alphay: vk.vk_alpha_1[1],
    betax1: vk.vk_beta_2[0][1], betax2: vk.vk_beta_2[0][0], betay1: vk.vk_beta_2[1][1], betay2: vk.vk_beta_2[1][0],
    gammax1: vk.vk_gamma_2[0][1], gammax2: vk.vk_gamma_2[0][0], gammay1: vk.vk_gamma_2[1][1], gammay2: vk.vk_gamma_2[1][0],
    deltax1: vk.vk_delta_2[0][1], deltax2: vk.vk_delta_2[0][0], deltay1: vk.vk_delta_2[1][1], deltay2: vk.vk_delta_2[1][0] };
  vk.IC.forEach((p, i) => { want['IC' + i + 'x'] = p[0]; want['IC' + i + 'y'] = p[1]; });
  const bad = Object.keys(want).filter((k) => m[k] !== String(want[k]));
  const extraIC = Object.keys(m).filter((k) => /^IC\d+x$/.test(k)).length !== vk.IC.length;
  return { ok: bad.length === 0 && !extraIC && nPub === vk.nPublic, bad, nPub };
}
function docHashes(doc) {
  const src = fs.readFileSync(path.join(ROOT, 'docs', doc), 'utf8'); const h = {};
  for (const x of src.matchAll(/^([0-9a-f]{64})\s+(\S+)/gm)) h[x[2]] = x[1];
  return h;
}
const git = (...a) => execFileSync('git', ['-C', ROOT, ...a], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();

async function main() {
  const t = recorder('P1.4 artifact consistency');

  // 1. hashes = ceremony docs (and the test chain artifact)
  const art = fs.existsSync(ART) ? JSON.parse(fs.readFileSync(ART, 'utf8')) : null;
  for (const [name, doc] of [['withdraw_v3', 'dev-ceremony-v3.md'], ['withdraw_v4', 'dev-ceremony-v4.md'], ['withdraw_v5', 'dev-ceremony-v5.md']]) {
    const h = docHashes(doc); const f = L.files(name);
    const hw = sha256(f.wasm), hz = sha256(f.zkey);
    t.rec(`${name}: sha256 of wasm and final zkey = docs/${doc}`, h[name + '.wasm'] === hw && h[name + '_final.zkey'] === hz, hz.slice(0, 16));
    if (art) t.rec(`${name}: sha256 = l2-eval-ci artifact (deployed build)`, art.source.circuits[`${name}/${name}.wasm`] === hw && art.source.circuits[`${name}/${name}_final.zkey`] === hz);
  }
  if (art) {
    t.rec('disclose: sha256 = l2-eval-ci artifact', art.source.circuits['disclose/disclose.wasm'] === sha256(path.join(BUILD, 'disclose', 'disclose.wasm'))
      && art.source.circuits['disclose/disclose_final.zkey'] === sha256(path.join(BUILD, 'disclose', 'disclose_final.zkey')));
    t.rec('l2-eval-ci artifact was built from commit 129a4c0', art.source.commit === DEPLOYED);
  } else t.skip('l2-eval-ci artifact checks', 'checkout not found at ' + L2 + ' (set L2_EVAL_CI)');

  // 1b. the demo pins the same files (by commit and sha256) and maps V7 pools to withdraw_v5
  {
    const demo = fs.readFileSync(path.join(ROOT, 'demo', 'index.html'), 'utf8');
    const commit = (demo.match(/const CIRCUIT_COMMIT = '([0-9a-f]{40})'/) || [])[1];
    let ok = commit === DEPLOYED, n = 0;
    for (const m of demo.matchAll(/circ\('([\w]+)',\s*'([0-9a-f]{64})',\s*'([0-9a-f]{64})'\)/g)) {
      n++;
      if (sha256(path.join(BUILD, m[1], m[1] + '.wasm')) !== m[2] || sha256(path.join(BUILD, m[1], m[1] + '_final.zkey')) !== m[3]) ok = false;
    }
    t.rec('demo/index.html: circuit files pinned to commit 129a4c0 and every pinned sha256 = the committed file', ok && n === 5, n + ' circuits');
    t.rec("demo/index.html: V7 pools prove with withdraw_v5 (circuit: v7 ? 'v5' …)", /circuit: v7 \? 'v5' : v6 \? 'v4' : v5 \? 'v3' : 'v2'/.test(demo));
  }

  // 2. vk: file = zkey export = Solidity
  const vks = {};
  for (const [name, sol] of [['withdraw_v3', 'WithdrawVerifierV3.sol'], ['withdraw_v4', 'WithdrawVerifierV4.sol'], ['withdraw_v5', 'WithdrawVerifierV5.sol'], ['disclose', 'DiscloseVerifier.sol']]) {
    const vk = await snarkjs.zKey.exportVerificationKey(path.join(BUILD, name, name + '_final.zkey'), quiet); vks[name] = vk;
    const vf = path.join(BUILD, name, 'verification_key.json');
    if (fs.existsSync(vf)) t.rec(`${name}: verification_key.json = vk exported from the final zkey`, JSON.stringify(JSON.parse(fs.readFileSync(vf))) === JSON.stringify(vk));
    const r = vkMatchesSol(vk, sol);
    t.rec(`${name}: every constant of contracts/${sol} = the zkey's vk (alpha, beta, gamma, delta, IC0..IC${vk.nPublic}); _pubSignals[${r.nPub}]`, r.ok, r.bad.slice(0, 3).join(','));
  }
  // withdraw_v2 has a zkey but no Solidity verifier in the repo; contracts/Verifier.sol (v1) has no zkey.
  const v2 = await snarkjs.zKey.exportVerificationKey(path.join(BUILD, 'withdraw_v2', 'withdraw_v2_final.zkey'), quiet);
  t.rec('withdraw (v1) contracts/Verifier.sol: no matching zkey in the repository (differs from the v2 key, as expected)', !vkMatchesSol(v2, 'Verifier.sol').ok);
  // gamma = G2 generator in every key (snarkjs default)
  const G2x0 = '10857046999023057135944570762232829481370756359578518086990519993285655852781';
  t.rec('vk_gamma_2 is the G2 generator in every key (snarkjs default; see report)', Object.values(vks).every((v) => v.vk_gamma_2[0][0] === G2x0));
  t.rec('delta differs between all keys (no zkey reused across circuits)', new Set(Object.values(vks).concat([v2]).map((v) => v.vk_delta_2[0][0])).size === 5);

  // 3. public input order: circuit = verifier = pools
  const circPub = (c) => (fs.readFileSync(path.join(ROOT, 'circuits', c + '.circom'), 'utf8').match(/public\s*\[([^\]]*)\]/)[1]).split(',').map((s) => s.trim());
  const declOrder = (c) => { // snarkjs orders public inputs by declaration order in the template, not by the list
    const src = fs.readFileSync(path.join(ROOT, 'circuits', c + '.circom'), 'utf8'); const pub = circPub(c);
    const tmpl = src.slice(src.lastIndexOf('template '));
    return [...tmpl.matchAll(/signal input (\w+)/g)].map((x) => x[1]).filter((x) => pub.includes(x));
  };
  for (const c of ['withdraw_v4', 'withdraw_v5']) {
    t.rec(`${c}: public list = declaration order = [root, nullifierHash, recipient, relayer, fee]`,
      JSON.stringify(circPub(c)) === JSON.stringify(declOrder(c)) && JSON.stringify(circPub(c)) === '["root","nullifierHash","recipient","relayer","fee"]');
  }
  t.rec('withdraw_v3: public [root, nullifierHash, recipient] in declaration order', JSON.stringify(declOrder('withdraw_v3')) === '["root","nullifierHash","recipient"]');
  t.rec('disclose: public [commitment, disclosureTag, auditorNonce] in declaration order', JSON.stringify(declOrder('disclose')) === '["commitment","disclosureTag","auditorNonce"]');
  for (const f of ['LatheonShieldedPoolV7Native.sol', 'LatheonShieldedPoolV7.sol', 'LatheonShieldedPoolV6Native.sol', 'LatheonShieldedPoolV6.sol']) {
    const src = fs.readFileSync(path.join(ROOT, 'contracts', f), 'utf8');
    const m = src.match(/pubSignals = \[([^\]]*)\]/);
    const got = m ? m[1].replace(/\s+/g, '') : '';
    t.rec(`${f}: pubSignals = [root, nullifierHash, uint160(recipient), uint160(relayer), fee]`,
      got === 'root,nullifierHash,uint256(uint160(recipient)),uint256(uint160(relayer)),fee', got.slice(0, 50));
  }

  // 4. zkey vs r1cs (A/B coefficients, header) and reproducible wasm — needs circom
  if (circom.available()) {
    for (const name of ['withdraw_v2', 'withdraw_v3', 'withdraw_v4', 'withdraw_v5', 'disclose']) {
      const b = circom.build(name);
      const r1 = await snarkjs.r1cs.exportJson(b.r1cs, quiet);
      const zk = await snarkjs.zKey.exportJson(path.join(BUILD, name, name + '_final.zkey'));
      const nC = r1.nConstraints;
      let bad = 0, cnt = 0;
      const want = new Map();
      r1.constraints.forEach((c, ci) => { for (const m of [0, 1]) for (const [s, v] of Object.entries(c[m])) want.set(m + ':' + ci + ':' + s, BigInt(v)); });
      for (let i = 0; i <= r1.nPubInputs + r1.nOutputs; i++) want.set('0:' + (nC + i) + ':' + i, 1n);   // snarkjs' extra public-input constraints
      for (const c of zk.ccoefs) { cnt++; const k = c.matrix + ':' + c.constraint + ':' + c.signal; if (want.get(k) !== BigInt(c.value)) bad++; want.delete(k); }
      const same = zk.nPublic === r1.nPubInputs + r1.nOutputs && zk.nVars === r1.nVars && bad === 0 && want.size === 0;
      t.rec(`${name}: final zkey header and A/B coefficient matrices = r1cs from circuits/${name}.circom (circom 2.2.3, ${b.profile.lib}${b.profile.opt ? ' ' + b.profile.opt : ''})`, same,
        `nVars zkey ${zk.nVars} / r1cs ${r1.nVars}, coefs ${cnt}, mismatched ${bad}, missing ${want.size}`);
      const fresh = sha256(b.wasm), committed = sha256(path.join(BUILD, name, name + '.wasm'));
      t.rec(`${name}: fresh build (circom 2.2.3, ${b.profile.lib}${b.profile.opt ? ' ' + b.profile.opt : ''}) reproduces the committed wasm byte for byte`, fresh === committed, fresh.slice(0, 12));
    }
  } else t.skip('zkey vs r1cs and reproducible wasm', 'set CIRCOM to a circom 2.2.3 binary');

  // 5. deployed commit = HEAD for contracts and circuits; deployed bytecode reproduced
  try {
    const diff = git('diff', '--stat', DEPLOYED, 'HEAD', '--', 'contracts', 'circuits').trim();
    t.rec('contracts/ and circuits/ at the deployed commit 129a4c0 = this checkout', diff === '', diff.split('\n').pop());
  } catch (e) { t.skip('129a4c0 vs HEAD', 'commit not in this checkout'); }
  if (art) {
    const srcFiles = Object.keys(art.source.sha256);
    const files = {}; let shaOk = true;
    for (const k of srcFiles) {
      const p = k === 'contracts/WrappedLTH.sol' ? path.join(L2, 'testnet', 'latheon', 'contracts', 'WrappedLTH.sol') : path.join(ROOT, k);
      const s = fs.readFileSync(p, 'utf8'); files[k] = s;
      if (crypto.createHash('sha256').update(s).digest('hex') !== art.source.sha256[k]) shaOk = false;
    }
    t.rec('sha256 of every contract source in the l2-eval-ci artifact = this checkout', shaOk);
    if (evm.solc.version() === art.compiler.replace(/^solc /, '')) {
      const out = evm.compile(files);
      const pick = { WithdrawVerifierV5: ['contracts/WithdrawVerifierV5.sol', 'WithdrawVerifierV5'], PoolV7Native: ['contracts/LatheonShieldedPoolV7Native.sol', 'LatheonShieldedPoolV7Native'],
        RouterV7Native: ['contracts/LatheonDistributionPoolV7Native.sol', 'LatheonDistributionPoolV7Native'], PoseidonT3: ['contracts/PoseidonT3.sol', 'PoseidonT3'],
        DiscloseVerifier: ['contracts/DiscloseVerifier.sol', 'Groth16Verifier'], WithdrawVerifierV4: ['contracts/WithdrawVerifierV4.sol', 'WithdrawVerifierV4'], WithdrawVerifier: ['contracts/WithdrawVerifierV3.sol', 'Groth16Verifier'] };
      for (const [k, [f, n]] of Object.entries(pick)) t.rec(`${k}: bytecode built here (solc ${evm.solc.version().split('+')[0]}) = l2-eval-ci artifact`, '0x' + out.contracts[f][n].evm.bytecode.object === art.contracts[k].bytecode);
    } else t.skip('bytecode comparison', 'solc ' + evm.solc.version() + ' differs from the artifact compiler');
  }
  const fails = t.done();
  process.exitCode = fails ? 1 : 0;
  return fails;
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); }).then(() => process.exit(process.exitCode || 0));
module.exports = { main };
