'use strict';
/*
 * Tests for LatheonShieldedPoolV8Native and LatheonDistributionPoolV8Native with REAL Groth16 proofs (withdraw_v6) on a
 * local EVM (ganache). The circuit is built from circuits/ with circom 2.2.3 ($CIRCOM); the Groth16 keys and the
 * Solidity verifier are THROWAWAY, made here from circuits/ptau/pot14_final.ptau and deleted at the end.
 *
 *   cd test/native-v8 && npm install && CIRCOM=/path/to/circom-2.2.3 npm test
 *
 * Internal tests, not an audit. Exit code 0 means every check passed.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const solc = require('solc');
const ganache = require('ganache');
const { ethers } = require('ethers');
const snarkjs = require('snarkjs');
const { poseidon2, poseidon3 } = require('poseidon-lite');
const { canonicalSplit } = require('../../sdk/distribution.js');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(p, 'utf8');
const P = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const E18 = 10n ** 18n;
const D18 = [100n * E18, 50n * E18, 10n * E18, 1n * E18];
const LEVELS = 20;
const Z = ethers.ZeroAddress;
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'latheon-native-v8-'));
const rnd = () => BigInt('0x' + crypto.randomBytes(31).toString('hex')) % P;
const abi = ethers.AbiCoder.defaultAbiCoder();
const tagOf = (s) => BigInt(ethers.keccak256(ethers.toUtf8Bytes(s))) % P;
const TAG = { COMMIT: tagOf('latheon.v8.commit'), NULL: tagOf('latheon.v8.null') };
const ctxOf = (chainId, pool) => BigInt(ethers.keccak256(abi.encode(['string', 'uint256', 'address'], ['latheon.v8.ctx', chainId, pool]))) % P;
const extHashOf = (e) => BigInt(ethers.keccak256(abi.encode(['address', 'address', 'uint256', 'bytes32', 'uint256'], [e.recipient, e.relayer, e.fee, e.reference, e.destChainId]))) % P;
const ref = () => ethers.hexlify(crypto.randomBytes(32));
const quiet = async (fn) => { const e = console.error, l = console.log; console.error = () => {}; console.log = () => {}; try { return await fn(); } finally { console.error = e; console.log = l; } };

function findImports(p) {
  for (const base of [path.join(__dirname, 'node_modules'), OUT]) { const f = path.join(base, p); if (fs.existsSync(f)) return { contents: read(f) }; }
  return { error: 'not found: ' + p };
}

const DOUBLES = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.39;
import "contracts/ILatheonV8.sol";
contract RefusingRecipient { receive() external payable { revert("no thanks"); } }
// Burns all the gas it is given.
contract GasBurner { uint256 public x; receive() external payable { while (true) { x++; } } }
// Reverts with 200 KB of return data.
contract ReturnBomb { receive() external payable { assembly { revert(0, 204800) } } }
// Needs about 160,000 gas when paid (seven new storage slots): more than the initial payout limit.
contract HungryRecipient { mapping(uint256 => uint256) public m; uint256 public n; receive() external payable { uint256 b = n; for (uint256 i = 0; i < 7; i++) m[b + i] = 1; n = b + 7; } }
// Uses about 40,000 gas when paid (well under the payout limit), then accepts.
contract BusyRecipient { uint256[4] public s; receive() external payable { s[0] = 1; s[1] = 2; } }
// When paid, tries to withdraw the same note again (same proof and nullifier).
contract ReenteringRecipient {
    ILatheonPoolV8Native pool; ProofV8 pr; uint256 root; uint256 nh; ExtDataV8 ext; bool armed;
    uint256 public payments; bool public reentrySucceeded; string public reentryError;
    function arm(address p, ProofV8 calldata proof, uint256 r, uint256 n, ExtDataV8 calldata e) external { pool = ILatheonPoolV8Native(p); pr = proof; root = r; nh = n; ext = e; armed = true; }
    receive() external payable {
        payments++;
        if (!armed) return;
        armed = false;
        try pool.withdraw(pr, root, nh, ext) { reentrySucceeded = true; } catch Error(string memory why) { reentryError = why; }
    }
}
contract RejectingNativePool {
    uint256 public DENOMINATION;
    constructor(uint256 d) { DENOMINATION = d; }
    function token() external pure returns (address) { return address(0); }
    function deposit(uint256) external payable { revert("Pool rejected the note"); }
}
`;

async function main() {
  const results = [];
  const rec = (name, ok, note) => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (note ? '   [' + note + ']' : '')); };
  // DEV_KEYS=1: use the committed development keys (circuits/build/withdraw_v6, contracts/WithdrawVerifierV6.sol, made in
  // docs/dev-ceremony-v8.md) instead of throwaway ones; this is the set that gets deployed.
  const DEV = process.env.DEV_KEYS === '1';
  let wasm, zkey, verifierSrc, verifierName;
  if (DEV) {
    console.log('Using the committed development keys of withdraw_v6...');
    wasm = path.join(ROOT, 'circuits', 'build', 'withdraw_v6', 'withdraw_v6.wasm'); zkey = path.join(ROOT, 'circuits', 'build', 'withdraw_v6', 'withdraw_v6_final.zkey');
    verifierSrc = read(path.join(ROOT, 'contracts', 'WithdrawVerifierV6.sol')); verifierName = 'WithdrawVerifierV6';
  } else {
    if (!process.env.CIRCOM || !fs.existsSync(process.env.CIRCOM)) throw new Error('Set CIRCOM to the circom 2.2.3 binary (or DEV_KEYS=1 for the committed keys).');
    console.log('Building withdraw_v6 and THROWAWAY keys...');
    const lib = path.join(OUT, 'lib'); fs.mkdirSync(lib);
    fs.symlinkSync(path.join(__dirname, 'node_modules', 'circomlib', 'circuits'), path.join(lib, 'circomlib'));
    execFileSync(process.env.CIRCOM, [path.join(ROOT, 'circuits', 'withdraw_v6.circom'), '--r1cs', '--wasm', '-l', lib, '-o', OUT], { encoding: 'utf8' });
    wasm = path.join(OUT, 'withdraw_v6_js', 'withdraw_v6.wasm'); zkey = path.join(OUT, 'withdraw_v6.zkey');
    await quiet(() => snarkjs.zKey.newZKey(path.join(OUT, 'withdraw_v6.r1cs'), path.join(ROOT, 'circuits', 'ptau', 'pot14_final.ptau'), zkey));
    verifierSrc = await snarkjs.zKey.exportSolidityVerifier(zkey, { groth16: read(path.join(__dirname, 'node_modules', 'snarkjs', 'templates', 'verifier_groth16.sol.ejs')) });
    verifierName = 'Groth16Verifier';
  }

  console.log('Compiling contracts with solc ' + solc.version() + '...');
  const sources = {
    'contracts/ILatheonV8.sol': { content: read(path.join(ROOT, 'contracts', 'ILatheonV8.sol')) },
    'contracts/Pool.sol': { content: read(path.join(ROOT, 'contracts', 'LatheonShieldedPoolV8Native.sol')) },
    'contracts/Dist.sol': { content: read(path.join(ROOT, 'contracts', 'LatheonDistributionPoolV8Native.sol')) },
    'contracts/PoseidonT3.sol': { content: read(path.join(ROOT, 'contracts', 'PoseidonT3.sol')) },
    'contracts/Verifier.sol': { content: verifierSrc },
    'contracts/Doubles.sol': { content: DOUBLES },
    'contracts/Timelock.sol': { content: '// SPDX-License-Identifier: MIT\npragma solidity 0.8.39;\nimport "@openzeppelin/contracts/governance/TimelockController.sol";\n' },
  };
  const out = JSON.parse(solc.compile(JSON.stringify({
    language: 'Solidity', sources,
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.bytecode.linkReferences', 'storageLayout'] } } },
  }), { import: findImports }));
  const errors = (out.errors || []).filter((e) => e.severity === 'error');
  if (errors.length) { errors.forEach((e) => console.log(e.formattedMessage)); throw new Error('compilation failed'); }
  const warnings = (out.errors || []).filter((e) => e.severity === 'warning' && /contracts\/(Pool|Dist|ILatheonV8)\.sol/.test(e.formattedMessage));
  rec('V8 contracts compile with solc 0.8.39 and no warnings', warnings.length === 0, warnings.map((w) => w.message).join('; ').slice(0, 120));
  const K = (f, n) => out.contracts['contracts/' + f][n];
  const C = { Pool: K('Pool.sol', 'LatheonShieldedPoolV8Native'), Dist: K('Dist.sol', 'LatheonDistributionPoolV8Native'), Poseidon: K('PoseidonT3.sol', 'PoseidonT3'),
    Ver: K('Verifier.sol', verifierName), Refusing: K('Doubles.sol', 'RefusingRecipient'), Burner: K('Doubles.sol', 'GasBurner'), Bomb: K('Doubles.sol', 'ReturnBomb'),
    Busy: K('Doubles.sol', 'BusyRecipient'), Hungry: K('Doubles.sol', 'HungryRecipient'), Reenter: K('Doubles.sol', 'ReenteringRecipient'), Rejecting: K('Doubles.sol', 'RejectingNativePool'),
    Timelock: out.contracts['@openzeppelin/contracts/governance/TimelockController.sol'].TimelockController };
  const slotOf = (c, label) => Number(c.storageLayout.storage.find((s) => s.label === label).slot);

  const link = (c, libs) => {
    let code = c.evm.bytecode.object; const refs = c.evm.bytecode.linkReferences;
    for (const f in refs) for (const l in refs[f]) for (const { start, length } of refs[f][l]) code = code.slice(0, start * 2) + libs[l].slice(2).toLowerCase() + code.slice(start * 2 + length * 2);
    return code;
  };
  const gp = ganache.provider({ logging: { quiet: true }, chain: { hardfork: 'shanghai', chainId: 60531373273 }, wallet: { deterministic: true, totalAccounts: 8, defaultBalance: 1_000_000 }, miner: { blockGasLimit: 60000000 } });
  const provider = new ethers.BrowserProvider(gp);
  const signers = await Promise.all([0, 1, 2, 3, 4].map((i) => provider.getSigner(i)));
  const [deployer, relayer, stranger, proposer] = signers;
  const chainId = (await provider.getNetwork()).chainId;
  const bal = (a) => provider.getBalance(a);
  const newAddr = () => ethers.Wallet.createRandom().address;
  const deploy = async (c, args = [], libs = {}) => { const f = new ethers.ContractFactory(c.abi, '0x' + link(c, libs), deployer); const x = await f.deploy(...args); await x.waitForDeployment(); return x; };
  const reason = async (fn) => { try { await fn(); return { reverted: false, msg: '' }; } catch (e) { return { reverted: true, msg: [e.reason, e.shortMessage, e.message].filter(Boolean).join(' | ') }; } };
  const refuseTx = async (contract, fn, args, overrides, text) => {
    const st = await reason(() => contract[fn].staticCall(...args, overrides || {}));
    const real = await reason(async () => { const rc = await (await contract[fn](...args, { gasLimit: 12_000_000, ...(overrides || {}) })).wait(); if (rc.status === 0) throw new Error('status 0'); });
    return { ok: (text ? st.msg.includes(text) : st.reverted) && real.reverted, note: st.msg.slice(0, 70) };
  };
  const J = (x) => JSON.stringify(x, (k, v) => (typeof v === 'bigint' ? v.toString() : v));

  const poseidonLib = await deploy(C.Poseidon); const libs = { PoseidonT3: await poseidonLib.getAddress() };
  const ver = await deploy(C.Ver); const verAddr = await ver.getAddress();
  const makePool = (d, guardian = Z) => deploy(C.Pool, [verAddr, d, guardian], libs);
  const makeSet = async (guardian = Z) => { const ps = []; for (const d of D18) ps.push(await makePool(d, guardian)); const dist = await deploy(C.Dist, [await Promise.all(ps.map((p) => p.getAddress()))]); return { ps, d: dist }; };

  // ---- local mirror of each pool's tree
  const leaves = new Map();
  const record = (rc, pools) => {
    for (const lg of rc.logs) for (const p of pools) {
      if (p.target.toLowerCase() !== lg.address.toLowerCase()) continue;
      const ev = p.interface.parseLog(lg);
      if (ev && ev.name === 'Deposit') { const k = p.target.toLowerCase(); if (!leaves.has(k)) leaves.set(k, []); leaves.get(k)[Number(ev.args.leafIndex)] = ev.args.commitment; }
    }
  };
  const zerosJs = [0n]; for (let i = 0; i < LEVELS; i++) zerosJs.push(poseidon2([zerosJs[i], zerosJs[i]]));
  const newNote = () => { const sk = rnd(), vk = rnd(); return { sk, vk, commitment: poseidon3([TAG.COMMIT, sk, vk]) }; };
  const extFor = (recipient, o = {}) => ({ recipient, relayer: Z, fee: 0n, reference: ref(), destChainId: chainId, ...o });
  const extTuple = (e) => [e.recipient, e.relayer, e.fee, e.reference, e.destChainId];
  async function proofFor(pool, note, ext, opt = {}) {
    const L = leaves.get(pool.target.toLowerCase()) || [];
    const leaf = L.indexOf(note.commitment); if (leaf < 0) throw new Error('note not in pool');
    const levels = [L.slice()];
    for (let l = 0; l < LEVELS; l++) { const cur = levels[l], up = []; for (let j = 0; j < Math.max(1, Math.ceil(cur.length / 2)); j++) up.push(poseidon2([cur[2 * j] ?? zerosJs[l], cur[2 * j + 1] ?? zerosJs[l]])); levels.push(up); }
    const el = [], idx = []; let k = leaf;
    for (let l = 0; l < LEVELS; l++) { el.push((levels[l][k ^ 1] ?? zerosJs[l]).toString()); idx.push(k & 1); k >>= 1; }
    const ctx = opt.ctx ?? BigInt(await pool.ctx());
    const input = { root: levels[LEVELS][0].toString(), nullifierHash: poseidon3([TAG.NULL, note.sk, ctx]).toString(), ctx: ctx.toString(), extDataHash: extHashOf(ext).toString(),
      spendKey: note.sk.toString(), viewKey: note.vk.toString(), pathElements: el, pathIndices: idx };
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasm, zkey);
    const [pA, pB, pC, pub] = JSON.parse('[' + (await snarkjs.groth16.exportSolidityCallData(proof, publicSignals)) + ']');
    return { proof: [pA, pB, pC], root: BigInt(pub[0]), nullifier: BigInt(pub[1]), pub };
  }
  const poolDeposit = async (pool, note, from = deployer) => { const rc = await (await pool.connect(from).deposit(note.commitment, { value: await pool.DENOMINATION() })).wait(); record(rc, [pool]); return rc; };
  const withdrawTx = (pool, pr, ext, from = relayer) => pool.connect(from).withdraw(pr.proof, pr.root, pr.nullifier, extTuple(ext));

  // ================================================================== pool
  console.log('\npool');
  const main = await makeSet();
  const [P100, P50, P10, P1] = main.ps;
  rec('constants: LEVELS 20, payoutGas 100,000 (at most 1,000,000); token() is address(0); zeros(20) is the Poseidon cascade',
    (await P1.LEVELS()) === 20n && (await P1.payoutGas()) === 100000n && (await P1.MAX_PAYOUT_GAS()) === 1000000n && (await P1.token()) === Z && (await P1.zeros(20)) === zerosJs[20], '');
  rec('ctx() = keccak256(abi.encode("latheon.v8.ctx", chainid, pool)) mod p, different for every pool', (await Promise.all(main.ps.map(async (p) => (await p.ctx()) === ctxOf(chainId, p.target)))).every(Boolean) && new Set(await Promise.all(main.ps.map(async (p) => String(await p.ctx())))).size === 4, 'chainId ' + chainId);
  const e0 = extFor(newAddr(), { relayer: newAddr(), fee: 5n, reference: ref() });
  rec('extDataHash() equals the reference formula', (await P1.extDataHash(extTuple(e0))) === extHashOf(e0), '');
  rec('the empty tree\'s root is known; 0 and a random number are not', (await P1.isKnownRoot(zerosJs[20])) && !(await P1.isKnownRoot(0n)) && !(await P1.isKnownRoot(rnd())), '');

  let r = await refuseTx(P1, 'deposit', [newNote().commitment], { value: E18 - 1n }, 'Wrong amount');
  rec('deposit: a wrong amount is refused', r.ok, r.note);
  const r0 = await refuseTx(P1, 'deposit', [0n], { value: E18 }, 'Commitment out of range');
  const rp = await refuseTx(P1, 'deposit', [P], { value: E18 }, 'Commitment out of range');
  const rbig = await refuseTx(P1, 'deposit', [P + 5n], { value: E18 }, 'Commitment out of range');
  rec('deposit: commitment 0, p and p+5 are refused ("Commitment out of range")', r0.ok && rp.ok && rbig.ok, r0.note);
  const ctorV = await reason(() => deploy(C.Pool, [Z, E18, Z], libs));
  const ctorD = await reason(() => deploy(C.Pool, [verAddr, 0n, Z], libs));
  rec('constructor: zero verifier and zero denomination are refused', ctorV.reverted && ctorD.reverted, '');

  const nA = newNote();
  const depA = await poolDeposit(P1, nA);
  rec('deposit: accepted; the pool holds the denomination; the new root is known', (await bal(P1.target)) === E18 && (await P1.isKnownRoot(await P1.currentRoot())), 'gas ' + depA.gasUsed);
  const ra = newAddr();
  const extA = extFor(ra);
  const prA = await proofFor(P1, nA, extA);
  rec('proof: four public signals [root, nullifierHash, ctx, extDataHash]', prA.pub.length === 4 && BigInt(prA.pub[2]) === (await P1.ctx()) && BigInt(prA.pub[3]) === extHashOf(extA), '');

  const changed = [['recipient', { recipient: newAddr() }], ['relayer', { relayer: newAddr() }], ['fee', { relayer: newAddr(), fee: 1n }], ['reference', { reference: ref() }]];
  let allRefused = true; const notes = [];
  for (const [label, o] of changed) { const x = await refuseTx(P1.connect(relayer), 'withdraw', [prA.proof, prA.root, prA.nullifier, extTuple({ ...extA, ...o })], null, 'Invalid proof'); if (!x.ok) { allRefused = false; notes.push(label + ': ' + x.note); } }
  rec('withdraw: the proof with another recipient, relayer, fee or reference is refused ("Invalid proof")', allRefused, notes.join('; '));
  r = await refuseTx(P1.connect(relayer), 'withdraw', [prA.proof, prA.root, prA.nullifier, extTuple({ ...extA, destChainId: 421614n })], null, 'Wrong destination chain');
  rec('withdraw: destChainId other than this chain is refused ("Wrong destination chain")', r.ok, r.note);
  r = await refuseTx(P1.connect(relayer), 'withdraw', [prA.proof, prA.root, prA.nullifier, extTuple({ ...extA, recipient: Z })], null, 'Zero recipient');
  rec('withdraw: zero recipient is refused', r.ok, '');
  r = await refuseTx(P1.connect(relayer), 'withdraw', [prA.proof, prA.root, prA.nullifier, extTuple({ ...extA, relayer: newAddr(), fee: E18 + 1n })], null, 'Fee exceeds denomination');
  const r2 = await refuseTx(P1.connect(relayer), 'withdraw', [prA.proof, prA.root, prA.nullifier, extTuple({ ...extA, fee: 1n })], null, 'Fee without relayer');
  rec('withdraw: fee above the denomination and a fee without relayer are refused', r.ok && r2.ok, '');
  r = await refuseTx(P1.connect(relayer), 'withdraw', [prA.proof, rnd(), prA.nullifier, extTuple(extA)], null, 'Unknown root');
  rec('withdraw: an unknown root is refused', r.ok, '');
  const wA = await (await withdrawTx(P1, prA, extA)).wait();
  const evW = wA.logs.map((l) => { try { return P1.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === 'Withdrawal');
  rec('withdraw: an empty address receives exactly the denomination, sent by a third party', (await bal(ra)) === E18 && (await bal(P1.target)) === 0n, 'gas ' + wA.gasUsed);
  rec('withdraw: the event carries recipient, nullifier, relayer, fee and reference', !!evW && evW.args.to === ra && evW.args.nullifierHash === prA.nullifier && evW.args.relayer === Z && evW.args.fee === 0n && evW.args.paymentRef === extA.reference, '');
  r = await refuseTx(P1.connect(relayer), 'withdraw', [prA.proof, prA.root, prA.nullifier, extTuple(extA)], null, 'Note already spent');
  rec('withdraw: the same note twice is refused ("Note already spent")', r.ok, '');

  // relayer fee
  const nF = newNote(); await poolDeposit(P1, nF);
  const relAddr = newAddr(), rf = newAddr(); const extF = extFor(rf, { relayer: relAddr, fee: E18 / 4n });
  const prF = await proofFor(P1, nF, extF);
  await (await withdrawTx(P1, prF, extF, stranger)).wait();
  rec('withdraw with a relayer fee: recipient gets denomination − fee, relayer gets the fee', (await bal(rf)) === E18 - E18 / 4n && (await bal(relAddr)) === E18 / 4n, '');

  // ---- context: the same note in two pools
  console.log('\ncontext: one proof, one pool, one chain');
  const twinA = await makePool(E18), twinB = await makePool(E18);
  const nT = newNote();
  await poolDeposit(twinA, nT); await poolDeposit(twinB, nT);
  rec('the same commitment deposited into two pools gives the same root in both', (await twinA.currentRoot()) === (await twinB.currentRoot()), '');
  const rt = newAddr(); const extT = extFor(rt);
  const prT = await proofFor(twinA, nT, extT);
  r = await refuseTx(twinB.connect(relayer), 'withdraw', [prT.proof, prT.root, prT.nullifier, extTuple(extT)], null, 'Invalid proof');
  rec('a proof made for pool A is refused by pool B although B knows the root ("Invalid proof")', r.ok, r.note);
  const prTb = await proofFor(twinA, nT, extT, { ctx: ctxOf(chainId, twinB.target) });
  rec('the nullifiers of one note in pools A and B differ', prTb.nullifier !== prT.nullifier, '');
  await (await withdrawTx(twinA, prT, extT)).wait();
  await (await twinB.connect(relayer).withdraw(prTb.proof, prTb.root, prTb.nullifier, extTuple(extT))).wait();
  rec('each pool pays its own deposit once, with a proof made for that pool', (await bal(rt)) === 2n * E18 && (await bal(twinA.target)) === 0n && (await bal(twinB.target)) === 0n, '');
  const nC = newNote(); await poolDeposit(P1, nC);
  const extC = extFor(newAddr());
  const prC = await proofFor(P1, nC, extC, { ctx: ctxOf(421614n, P1.target) });
  r = await refuseTx(P1.connect(relayer), 'withdraw', [prC.proof, prC.root, prC.nullifier, extTuple(extC)], null, 'Invalid proof');
  rec('a proof made for the same pool address on another chain is refused', r.ok, r.note);

  // ---- payouts
  console.log('\npayouts: refusing, re-entering, gas-burning and return-bomb recipients');
  const tryBadRecipient = async (contractDef, label) => {
    const target = await deploy(contractDef);
    const n = newNote(); await poolDeposit(P10, n);
    const e = extFor(target.target);
    const pr = await proofFor(P10, n, e);
    const before = await bal(P10.target);
    let gasUsed = null;
    const st = await reason(() => P10.connect(relayer).withdraw.staticCall(pr.proof, pr.root, pr.nullifier, extTuple(e)));
    try { const tx = await P10.connect(relayer).withdraw(pr.proof, pr.root, pr.nullifier, extTuple(e), { gasLimit: 3_000_000 }); const rc = await tx.wait(); gasUsed = rc.gasUsed; } catch (x) { gasUsed = x.receipt ? x.receipt.gasUsed : null; }
    return { reverted: st.msg.includes('Native transfer failed'), unspent: !(await P10.nullifierHashes(pr.nullifier)), held: (await bal(P10.target)) === before, gasUsed, n, pr, e };
  };
  const ref1 = await tryBadRecipient(C.Refusing);
  rec('a recipient that refuses the coin: "Native transfer failed", the note stays unspent, the pool keeps the coin', ref1.reverted && ref1.unspent && ref1.held, '');
  const burn = await tryBadRecipient(C.Burner);
  rec('a recipient that burns all gas: refused, note unspent, and the failed call costs under 500,000 gas', burn.reverted && burn.unspent && burn.held && (burn.gasUsed === null || burn.gasUsed < 500000n), 'gas ' + burn.gasUsed);
  const bomb = await tryBadRecipient(C.Bomb);
  rec('a recipient that reverts with 200 KB of data: refused, note unspent, under 500,000 gas (no return data copied)', bomb.reverted && bomb.unspent && bomb.held && (bomb.gasUsed === null || bomb.gasUsed < 500000n), 'gas ' + bomb.gasUsed);
  const fixAddr = newAddr(); const eFix = extFor(fixAddr); const prFix = await proofFor(P10, ref1.n, eFix);
  await (await withdrawTx(P10, prFix, eFix)).wait();
  rec('… the refused note is withdrawn later with a new proof to another address', (await bal(fixAddr)) === 10n * E18, '');
  const busy = await deploy(C.Busy);
  const nB = newNote(); await poolDeposit(P10, nB); const eB = extFor(busy.target); const prB = await proofFor(P10, nB, eB);
  await (await withdrawTx(P10, prB, eB)).wait();
  rec('a contract recipient that does some work (two storage writes) is paid normally', (await bal(busy.target)) === 10n * E18, '');
  const re = await deploy(C.Reenter);
  const nE = newNote(); await poolDeposit(P10, nE); const eE = extFor(re.target); const prE = await proofFor(P10, nE, eE);
  await (await re.arm(P10.target, prE.proof, prE.root, prE.nullifier, extTuple(eE))).wait();
  await (await withdrawTx(P10, prE, eE)).wait();
  rec('a recipient that re-enters withdraw() while paid: paid once, re-entry refused "Note already spent"', (await re.payments()) === 1n && !(await re.reentrySucceeded()) && (await re.reentryError()) === 'Note already spent', '');
  r = await reason(async () => (await deployer.sendTransaction({ to: P10.target, value: 1n })).wait());
  rec('a plain transfer to the pool is refused (no receive)', r.reverted, '');

  // ---- root history
  console.log('\nroot history');
  const hist = await makePool(E18);
  const nH = newNote(); await poolDeposit(hist, nH);
  const eH = extFor(newAddr()); const prH = await proofFor(hist, nH, eH);
  for (let i = 0; i < 150; i++) await poolDeposit(hist, newNote());
  rec('a proof made before 150 more deposits still withdraws (V7 refused it after 100)', await (async () => { await (await withdrawTx(hist, prH, eH)).wait(); return (await bal(eH.recipient)) === E18; })(), '');
  rec('… and the empty tree\'s root and the root right after the first deposit are still known after 151 deposits (all roots are kept)', (await hist.isKnownRoot(zerosJs[20])) && (await hist.isKnownRoot(prH.root)), '');

  // ---- pause by a timelocked guardian
  console.log('\ndeposit pause (guardian = OpenZeppelin TimelockController, delay 1 hour)');
  const proposerAddr = await proposer.getAddress();
  const timelock = await deploy(C.Timelock, [3600, [proposerAddr], [proposerAddr], Z]);
  const gset = await makeSet(timelock.target);
  const gP1 = gset.ps[3];
  rec('guardian() is the timelock', (await gP1.guardian()) === timelock.target, '');
  r = await refuseTx(gP1.connect(deployer), 'setDepositsPaused', [true], null, 'Not the guardian');
  rec('anyone other than the guardian is refused ("Not the guardian")', r.ok, '');
  r = await refuseTx(P1.connect(deployer), 'setDepositsPaused', [true], null, 'Not the guardian');
  rec('a pool deployed without a guardian can never be paused', r.ok, '');
  const calldata = gP1.interface.encodeFunctionData('setDepositsPaused', [true]);
  const salt = ethers.ZeroHash;
  await (await timelock.connect(proposer).schedule(gP1.target, 0, calldata, ethers.ZeroHash, salt, 3600)).wait();
  r = await reason(async () => (await timelock.connect(proposer).execute(gP1.target, 0, calldata, ethers.ZeroHash, salt, { gasLimit: 500000 })).wait());
  rec('the pause cannot be executed before the delay', r.reverted, '');
  await provider.send('evm_increaseTime', [3601]); await provider.send('evm_mine', []);
  const nP = newNote(); await poolDeposit(gP1, nP);
  const nHg = newNote(); await poolDeposit(gP1, nHg);
  await (await timelock.connect(proposer).execute(gP1.target, 0, calldata, ethers.ZeroHash, salt)).wait();
  rec('after the delay the timelock pauses deposits', (await gP1.depositsPaused()) === true, '');
  r = await refuseTx(gP1, 'deposit', [newNote().commitment], { value: E18 }, 'Deposits paused');
  const rr = await refuseTx(gset.d, 'deposit', [E18, [newNote().commitment]], { value: E18 }, 'Deposits paused');
  rec('paused: deposits into the pool and through the router are refused ("Deposits paused")', r.ok && rr.ok, '');
  const eP = extFor(newAddr()); const prP = await proofFor(gP1, nP, eP);
  await (await withdrawTx(gP1, prP, eP)).wait();
  rec('paused: withdrawals still work', (await bal(eP.recipient)) === E18, '');

  console.log('\npayout gas: only the guardian, only up');
  const hungry = await deploy(C.Hungry);
  const unpause = gP1.interface.encodeFunctionData('setDepositsPaused', [false]);
  const eHg = extFor(hungry.target); const prHg = await proofFor(gP1, nHg, eHg);
  r = await refuseTx(gP1.connect(relayer), 'withdraw', [prHg.proof, prHg.root, prHg.nullifier, extTuple(eHg)], null, 'Native transfer failed');
  rec('a contract recipient that needs ~160,000 gas is not paid at 100,000; the note stays unspent', r.ok && !(await gP1.nullifierHashes(prHg.nullifier)), r.note);
  r = await refuseTx(gP1.connect(deployer), 'raisePayoutGas', [200000n], null, 'Not the guardian');
  const rNo = await refuseTx(P1.connect(deployer), 'raisePayoutGas', [200000n], null, 'Not the guardian');
  rec('nobody but the guardian can raise it; a pool without a guardian keeps 100,000 forever', r.ok && rNo.ok, '');
  const viaTimelock = async (data) => { const salt2 = ethers.hexlify(crypto.randomBytes(32)); await (await timelock.connect(proposer).schedule(gP1.target, 0, data, ethers.ZeroHash, salt2, 3600)).wait(); await provider.send('evm_increaseTime', [3601]); await provider.send('evm_mine', []); return reason(async () => (await timelock.connect(proposer).execute(gP1.target, 0, data, ethers.ZeroHash, salt2, { gasLimit: 500000 })).wait()); };
  const down = await viaTimelock(gP1.interface.encodeFunctionData('raisePayoutGas', [50000n]));
  const tooHigh = await viaTimelock(gP1.interface.encodeFunctionData('raisePayoutGas', [1000001n]));
  rec('through the timelock: lowering (50,000) and going above 1,000,000 are refused', down.reverted && tooHigh.reverted && (await gP1.payoutGas()) === 100000n, '');
  const up = await viaTimelock(gP1.interface.encodeFunctionData('raisePayoutGas', [250000n]));
  rec('through the timelock, after the delay: raised to 250,000', !up.reverted && (await gP1.payoutGas()) === 250000n, '');
  await (await withdrawTx(gP1, prHg, eHg)).wait();
  rec('… now the same proof pays the hungry recipient', (await bal(hungry.target)) === E18, '');
  await viaTimelock(unpause);

  // ================================================================== router
  console.log('\nrouter');
  const known = [1n, 61n, 99n, 100n, 161n, 3199n];
  let same = true;
  for (const a of known.concat(Array.from({ length: 20 }, () => BigInt(1 + crypto.randomInt(3000))))) {
    const [counts, total] = await main.d.split(a * E18);
    const js = canonicalSplit(a * E18, D18);
    if (J(counts) !== J(js.counts) || total !== BigInt(js.total)) { same = false; break; }
  }
  rec('split(): the on-chain rule equals sdk/distribution.js for known and random amounts', same, '');
  const set = await makeSet();
  const depNotes = Array.from({ length: 7 }, newNote); // 61 = 50 + 10 + 1
  const amt = 161n * E18; // 100 + 50 + 10 + 1 → 4 notes
  const four = depNotes.slice(0, 4);
  const rcD = await (await set.d.deposit(amt, four.map((n) => n.commitment), { value: amt })).wait(); record(rcD, set.ps);
  rec('deposit 161 LTH: one note in each pool, the router holds nothing', (await Promise.all(set.ps.map((p) => p.nextIndex()))).every((x) => x === 1n) && (await bal(set.d.target)) === 0n, 'gas ' + rcD.gasUsed);
  r = await refuseTx(set.d, 'deposit', [E18, [0n]], { value: E18 }, 'Commitment out of range');
  rec('router deposit with commitment 0 is refused by the pool and nothing is kept', r.ok && (await bal(set.d.target)) === 0n, '');
  const ctorBad = await reason(() => deploy(C.Dist, [[set.ps[1].target, set.ps[0].target, set.ps[2].target, set.ps[3].target]]));
  rec('constructor: pools in the wrong order are refused', ctorBad.reverted, '');

  const rcpt = newAddr(), relB = newAddr();
  const item = async (k, n, fee = 0n) => { const reference = ref(); const e = { recipient: rcpt, relayer: relB, fee, reference, destChainId: chainId }; const pr = await proofFor(set.ps[k], n, e); return { pool: k, proof: pr.proof, root: pr.root, nullifierHash: pr.nullifier, fee, reference, _pr: pr, _e: e }; };
  const strip = (it) => [it.pool, it.proof, it.root, it.nullifierHash, it.fee, it.reference];
  const it0 = await item(0, four[0], E18), it1 = await item(1, four[1], E18 / 2n), it2 = await item(2, four[2]), it3 = await item(3, four[3]);
  // someone withdraws note 2 directly first
  await (await set.ps[2].connect(stranger).withdraw(it2._pr.proof, it2._pr.root, it2._pr.nullifier, extTuple(it2._e))).wait();
  const batch = [it0, it1, it2, it3].map(strip);
  const paidStatic = await set.d.connect(relayer).withdrawMany.staticCall(batch, rcpt, relB);
  const rcM = await (await set.d.connect(relayer).withdrawMany(batch, rcpt, relB)).wait();
  const evs = rcM.logs.map((l) => { try { return set.d.interface.parseLog(l); } catch { return null; } }).filter(Boolean);
  const skippedEv = evs.filter((e) => e.name === 'NoteSkipped');
  const many = evs.find((e) => e.name === 'WithdrawnMany');
  rec('withdrawMany: a note already withdrawn by someone else is skipped, the other three are paid', paidStatic === 3n && skippedEv.length === 1 && skippedEv[0].args.nullifierHash === it2.nullifierHash && many.args.paid === 3n && many.args.skipped === 1n, 'gas ' + rcM.gasUsed);
  rec('… amounts: recipient 100+50+10+1 − fees 1.5 (note 2 was paid earlier by its direct withdrawal), relayer 1.5', (await bal(rcpt)) === 161n * E18 - E18 - E18 / 2n && (await bal(relB)) === E18 + E18 / 2n, '');
  r = await refuseTx(set.d.connect(relayer), 'withdrawMany', [batch, rcpt, relB], null, 'Nothing to withdraw');
  rec('withdrawMany: a batch in which every note is spent is refused ("Nothing to withdraw")', r.ok, '');

  const set2 = await makeSet();
  const two = [newNote(), newNote()];
  const rc2 = await (await set2.d.deposit(2n * E18, two.map((n) => n.commitment), { value: 2n * E18 })).wait(); record(rc2, set2.ps);
  const rcpt2 = newAddr();
  const mk = async (n, e) => { const pr = await proofFor(set2.ps[3], n, e); return [3, pr.proof, pr.root, pr.nullifier, e.fee, e.reference]; };
  const eA2 = { recipient: rcpt2, relayer: Z, fee: 0n, reference: ref(), destChainId: chainId };
  const eB2 = { ...eA2, reference: ref() };
  const a2 = await mk(two[0], eA2), b2 = await mk(two[1], eB2);
  const wrongRef = [...b2]; wrongRef[5] = ref();
  r = await refuseTx(set2.d.connect(relayer), 'withdrawMany', [[a2, wrongRef], rcpt2, Z], null, 'Invalid proof');
  rec('withdrawMany: one item with a changed reference makes the whole batch revert; nothing paid', r.ok && (await bal(rcpt2)) === 0n, '');
  const rcDup = await (await set2.d.connect(relayer).withdrawMany([a2, a2, b2], rcpt2, Z)).wait();
  const dupEv = rcDup.logs.map((l) => { try { return set2.d.interface.parseLog(l); } catch { return null; } }).filter((e) => e && e.name === 'NoteSkipped');
  rec('withdrawMany: a note named twice in one batch is paid once and skipped once', (await bal(rcpt2)) === 2n * E18 && dupEv.length === 1, '');
  r = await refuseTx(set2.d.connect(relayer), 'withdrawMany', [[a2], rcpt2, Z], null, 'Nothing to withdraw');
  rec('withdrawMany: the router never holds coin', (await bal(set2.d.target)) === 0n && r.ok, '');

  // ================================================================== gas
  console.log('\ngas (local EVM, ganache shanghai, solc 0.8.39 optimizer 200)');
  const gset2 = await makeSet();
  const gas = {};
  for (const [amount, label] of [[1n, '1 note'], [3n, '3 notes'], [161n, '4 notes'], [1899n, '32 notes']]) {
    const n = canonicalSplit(amount * E18, D18).total; const ns = Array.from({ length: Number(n) }, newNote);
    const rc = await (await gset2.d.deposit(amount * E18, ns.map((x) => x.commitment), { value: amount * E18 })).wait(); record(rc, gset2.ps);
    gas['router deposit ' + label] = rc.gasUsed;
    if (label === '3 notes') gas._three = ns;
  }
  const one = newNote(); gas['pool deposit 1 note'] = (await poolDeposit(gset2.ps[3], one)).gasUsed;
  const eo = extFor(newAddr()); const pro = await proofFor(gset2.ps[3], one, eo);
  gas['pool withdraw 1 note'] = (await (await withdrawTx(gset2.ps[3], pro, eo)).wait()).gasUsed;
  const rc3 = newAddr();
  const mkG = async (n) => { const e = { recipient: rc3, relayer: Z, fee: 0n, reference: ref(), destChainId: chainId }; const pr = await proofFor(gset2.ps[3], n, e); return [3, pr.proof, pr.root, pr.nullifier, 0n, e.reference]; };
  const threeItems = [];
  for (const n of gas._three) threeItems.push(await mkG(n));
  gas['withdrawMany 3 notes'] = (await (await gset2.d.connect(relayer).withdrawMany(threeItems, rc3, Z)).wait()).gasUsed;
  delete gas._three;
  for (const [k, v] of Object.entries(gas)) console.log(`  ${k}: ${v.toLocaleString('en-US')}`);
  rec('gas measured', true, '');

  fs.rmSync(OUT, { recursive: true, force: true });
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); try { fs.rmSync(OUT, { recursive: true, force: true }); } catch (_) {} process.exit(1); });
