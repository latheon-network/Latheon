'use strict';
/*
 * Integration tests for LatheonShieldedPoolV5, with REAL Groth16 proofs on a local EVM (ganache).
 *
 * What is checked
 *   V5   - a proof made for one recipient cannot be replayed to pay another address
 *        - the proof carries 3 public signals and the third equals the intended recipient
 *        - denominations 100 / 50 / 10 / 1 of an 18-decimals token and 100 of a 6-decimals token
 *        - a note cannot be spent twice; zero recipient and zero denomination are rejected
 *   V4   - REPRODUCTION of the flaw V5 fixes: V4 accepts a proof submitted with a different recipient
 *
 * Everything is read from this repository: contracts/ and circuits/build/. The V2 verifier used for the V4
 * reproduction is generated from circuits/build/withdraw_v2/withdraw_v2_final.zkey at run time.
 *
 * Local EVM only (solc evmVersion "paris", ganache "shanghai"). It does not replace an independent audit.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const solc = require('solc');
const ganache = require('ganache');
const ejs = require('ejs');
const { ethers } = require('ethers');
const snarkjs = require('snarkjs');
const { poseidon2 } = require('poseidon-lite');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(p, 'utf8');
const V3 = path.join(ROOT, 'circuits', 'build', 'withdraw_v3');
const V2 = path.join(ROOT, 'circuits', 'build', 'withdraw_v2');
const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const E18 = 10n ** 18n, E6 = 10n ** 6n;
const rnd = () => BigInt('0x' + crypto.randomBytes(31).toString('hex')) % FIELD;

function findImports(p) {
  const f = path.join(__dirname, 'node_modules', p);
  return fs.existsSync(f) ? { contents: read(f) } : { error: 'not found: ' + p };
}

async function main() {
  const results = [];
  const rec = (name, ok, note) => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (note ? '   [' + note + ']' : '')); };

  // ---- generate the V2 verifier (for the V4 reproduction) from the repository's own proving key ----
  const vkey2 = await snarkjs.zKey.exportVerificationKey(path.join(V2, 'withdraw_v2_final.zkey'));
  const verifierV2 = ejs.render(read(path.join(__dirname, 'node_modules', 'snarkjs', 'templates', 'verifier_groth16.sol.ejs')), vkey2);

  console.log('Compiling contracts from this repository...');
  const sources = {
    'contracts/V5.sol': { content: read(path.join(ROOT, 'contracts', 'LatheonShieldedPoolV5.sol')) },
    'contracts/V4.sol': { content: read(path.join(ROOT, 'contracts', 'LatheonShieldedPoolV4.sol')) },
    'contracts/PoseidonT3.sol': { content: read(path.join(ROOT, 'contracts', 'PoseidonT3.sol')) },
    'contracts/Token.sol': { content: read(path.join(ROOT, 'contracts', 'LatheonToken.sol')) },
    'contracts/VerifierV5.sol': { content: read(path.join(ROOT, 'contracts', 'WithdrawVerifierV3.sol')) },
    'contracts/VerifierV2.sol': { content: verifierV2 },
    'contracts/Token6.sol': { content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
contract Token6 is ERC20 {
    constructor() ERC20("Test6", "T6") { _mint(msg.sender, 1_000_000 * 10 ** 6); }
    function decimals() public pure override returns (uint8) { return 6; }
}` },
  };
  const out = JSON.parse(solc.compile(JSON.stringify({
    language: 'Solidity', sources,
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.bytecode.linkReferences'] } } },
  }), { import: findImports }));
  const errors = (out.errors || []).filter((e) => e.severity === 'error');
  if (errors.length) { errors.forEach((e) => console.log(e.formattedMessage)); throw new Error('compilation failed'); }
  const K = (f, n) => out.contracts['contracts/' + f][n];
  const C = { Pool5: K('V5.sol', 'LatheonShieldedPoolV5'), Pool4: K('V4.sol', 'LatheonShieldedPoolV4'), Poseidon: K('PoseidonT3.sol', 'PoseidonT3'),
    Token: K('Token.sol', 'LatheonToken'), Ver5: K('VerifierV5.sol', 'Groth16Verifier'), Ver2: K('VerifierV2.sol', 'Groth16Verifier'), Token6: K('Token6.sol', 'Token6') };

  const link = (c, libs) => {
    let code = c.evm.bytecode.object; const refs = c.evm.bytecode.linkReferences;
    for (const f in refs) for (const l in refs[f]) for (const { start, length } of refs[f][l])
      code = code.slice(0, start * 2) + libs[l].slice(2).toLowerCase() + code.slice(start * 2 + length * 2);
    return code;
  };

  const gp = ganache.provider({ logging: { quiet: true }, chain: { hardfork: 'shanghai' }, wallet: { deterministic: true }, miner: { blockGasLimit: 60000000 } });
  const provider = new ethers.BrowserProvider(gp);
  const [deployer, relayer, recipient, attacker] = await Promise.all([0, 1, 2, 3].map((i) => provider.getSigner(i)));
  const [deployerAddr, recipientAddr, attackerAddr] = await Promise.all([deployer.getAddress(), recipient.getAddress(), attacker.getAddress()]);

  const deploy = async (c, args = [], libs = {}) => {
    const f = new ethers.ContractFactory(c.abi, '0x' + link(c, libs), deployer);
    const x = await f.deploy(...args); await x.waitForDeployment(); return x;
  };
  const reason = async (fn) => { try { await fn(); return { reverted: false, msg: '' }; } catch (e) { return { reverted: true, msg: [e.reason, e.shortMessage, e.message].filter(Boolean).join(' | ') }; } };

  const lib = await deploy(C.Poseidon); const libs = { PoseidonT3: await lib.getAddress() };
  const ver5 = await deploy(C.Ver5), ver2 = await deploy(C.Ver2);
  const lth = await deploy(C.Token, [deployerAddr]), tok6 = await deploy(C.Token6);

  // Merkle inputs for a pool that holds exactly one deposit (leaf index 0), read from the contract itself
  async function proofFor(pool, spendKey, viewKey, wasm, zkey, recipientForProof) {
    const zeros = []; for (let i = 0; i < 8; i++) zeros.push((await pool.zeros(i)).toString());
    const root = await pool.roots(await pool.currentRootIndex());
    const input = { root: root.toString(), nullifierHash: poseidon2([spendKey, 1n]).toString(), spendKey: spendKey.toString(), viewKey: viewKey.toString(), pathElements: zeros, pathIndices: new Array(8).fill(0) };
    if (recipientForProof) input.recipient = BigInt(recipientForProof).toString();
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasm, zkey);
    const [pA, pB, pC, pub] = JSON.parse('[' + (await snarkjs.groth16.exportSolidityCallData(proof, publicSignals)) + ']');
    return { pA, pB, pC, pub };
  }
  const w3 = path.join(V3, 'withdraw_v3.wasm'), z3 = path.join(V3, 'withdraw_v3_final.zkey');

  // ------------------------------------------------------------------ V5
  console.log('\nV5 pools');
  async function v5Scenario(label, token, denom, extra) {
    const pool = await deploy(C.Pool5, [await token.getAddress(), await ver5.getAddress(), denom], libs);
    const spendKey = rnd(), viewKey = rnd();
    await (await token.approve(await pool.getAddress(), denom)).wait();
    await (await pool.deposit(poseidon2([poseidon2([spendKey, viewKey]), 0n]))).wait();
    const { pA, pB, pC, pub } = await proofFor(pool, spendKey, viewKey, w3, z3, recipientAddr);   // proof made FOR recipientAddr
    const bound = pub.length === 3 && BigInt(pub[2]) === BigInt(recipientAddr);
    const root = pub[0], nullifier = pub[1];

    const atkBefore = await token.balanceOf(attackerAddr), poolBefore = await token.balanceOf(await pool.getAddress());
    const atkStatic = await reason(() => pool.connect(attacker).withdraw.staticCall(pA, pB, pC, root, nullifier, attackerAddr));
    const atkReal = await reason(() => pool.connect(attacker).withdraw(pA, pB, pC, root, nullifier, attackerAddr));
    const blocked = atkStatic.reverted && atkStatic.msg.includes('Invalid proof') && atkReal.reverted &&
      (await token.balanceOf(attackerAddr)) === atkBefore && (await token.balanceOf(await pool.getAddress())) === poolBefore;

    const before = await token.balanceOf(recipientAddr);
    await (await pool.connect(relayer).withdraw(pA, pB, pC, root, nullifier, recipientAddr)).wait();
    const paid = (await token.balanceOf(recipientAddr)) - before;
    rec(`V5 ${label}: proof carries 3 signals, third == recipient`, bound, '');
    rec(`V5 ${label}: replay with another recipient is rejected ("Invalid proof"), balances unchanged`, blocked, atkStatic.msg.slice(0, 40));
    rec(`V5 ${label}: intended recipient receives exactly the denomination, pool is emptied`, paid === denom && (await token.balanceOf(await pool.getAddress())) === 0n, '');
    if (extra) {
      const ds = await reason(() => pool.connect(relayer).withdraw.staticCall(pA, pB, pC, root, nullifier, recipientAddr));
      rec('V5: spending the same note twice is rejected ("Note already spent")', ds.reverted && ds.msg.includes('Note already spent'), '');
      const zr = await reason(() => pool.connect(relayer).withdraw.staticCall(pA, pB, pC, root, nullifier, ethers.ZeroAddress));
      rec('V5: zero recipient is rejected', zr.reverted && zr.msg.includes('Zero recipient'), '');
    }
  }
  await v5Scenario('100 (18 decimals)', lth, 100n * E18, true);
  await v5Scenario('50 (18 decimals)', lth, 50n * E18);
  await v5Scenario('10 (18 decimals)', lth, 10n * E18);
  await v5Scenario('1 (18 decimals)', lth, 1n * E18);
  await v5Scenario('100 (6 decimals, USDG-like)', tok6, 100n * E6);
  const zf = new ethers.ContractFactory(C.Pool5.abi, '0x' + link(C.Pool5, libs), deployer);
  const zd = await zf.getDeployTransaction(await lth.getAddress(), await ver5.getAddress(), 0n);
  const zero = await reason(() => provider.call({ data: zd.data }));
  rec('V5: deploying with a zero denomination is rejected', zero.reverted && zero.msg.includes('Denomination must be positive'), '');

  // ------------------------------------------------------------------ V4 (reproduction of the flaw)
  console.log('\nV4 (legacy) - reproduction of the flaw that V5 fixes');
  const pool4 = await deploy(C.Pool4, [await lth.getAddress(), await ver2.getAddress()], libs);
  const sk = rnd(), vk = rnd();
  await (await lth.approve(await pool4.getAddress(), 100n * E18)).wait();
  await (await pool4.deposit(poseidon2([poseidon2([sk, vk]), 0n]))).wait();
  const p4 = await proofFor(pool4, sk, vk, path.join(V2, 'withdraw_v2.wasm'), path.join(V2, 'withdraw_v2_final.zkey'), null);
  const before = await lth.balanceOf(attackerAddr);
  let attackWorked = false;
  try { await (await pool4.connect(attacker).withdraw(p4.pA, p4.pB, p4.pC, p4.pub, attackerAddr)).wait(); attackWorked = (await lth.balanceOf(attackerAddr)) - before === 100n * E18; } catch (e) { attackWorked = false; }
  rec('V4 reproduction: a proof is accepted when submitted with a different recipient (the flaw, fixed in V5)', attackWorked, 'attacker received 100 LTH on V4');

  const ok = results.every(Boolean);
  console.log('\n' + (ok ? `ALL ${results.length} CHECKS PASSED` : `FAILED: ${results.filter((x) => !x).length} of ${results.length}`));
  return ok;
}

main().then((ok) => process.exit(ok ? 0 : 1)).catch((e) => { console.error('ERROR:', e && e.message ? e.message : e); process.exit(1); });
