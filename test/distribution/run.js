'use strict';
/*
 * Integration tests for LatheonDistributionPool on top of the REAL V5 pools, with REAL Groth16 proofs, on a local EVM.
 *
 * What is checked
 *   split      - the on-chain rule equals the client mirror (sdk/distribution.js) for known and random amounts
 *   deposit    - an arbitrary amount becomes the canonical notes in the right pools; nothing stays in the router;
 *                the allowance is back to zero; events carry the commitments in the documented order
 *   composable - every note is an ordinary V5 note: each one is withdrawn with the ordinary withdraw() to a
 *                DIFFERENT address (a deposit can be taken out in parts, the other notes stay available)
 *   refusals   - wrong number of commitments, duplicates, zero amount, amount off the grid, too many notes, no
 *                allowance, no balance; and a full pool rolls the whole call back (atomicity)
 *   deploy     - constructor rejects a pool of another token, wrong order, denominations that do not divide
 *   decimals   - the same on a 6-decimals token (USDG-like)
 *   gas        - measured gas per number of notes (prints a table; sets the MAX_NOTES bound)
 *
 * Local EVM only (solc evmVersion "paris", ganache "shanghai"). It does not replace an independent audit.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const solc = require('solc');
const ganache = require('ganache');
const { ethers } = require('ethers');
const snarkjs = require('snarkjs');
const { poseidon2 } = require('poseidon-lite');
const { canonicalSplit, noteOrder, roundDown } = require('../../sdk/distribution.js');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(p, 'utf8');
const V3 = path.join(ROOT, 'circuits', 'build', 'withdraw_v3');
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

  console.log('Compiling contracts from this repository...');
  const sources = {
    'contracts/V5.sol': { content: read(path.join(ROOT, 'contracts', 'LatheonShieldedPoolV5.sol')) },
    'contracts/Dist.sol': { content: read(path.join(ROOT, 'contracts', 'LatheonDistributionPool.sol')) },
    'contracts/PoseidonT3.sol': { content: read(path.join(ROOT, 'contracts', 'PoseidonT3.sol')) },
    'contracts/Token.sol': { content: read(path.join(ROOT, 'contracts', 'LatheonToken.sol')) },
    'contracts/VerifierV5.sol': { content: read(path.join(ROOT, 'contracts', 'WithdrawVerifierV3.sol')) },
    'contracts/Rejecting.sol': { content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
// Test double: looks like a fixed pool but rejects every note. Used only to prove the router rolls back atomically.
contract RejectingPool {
    IERC20 public token; uint256 public DENOMINATION;
    constructor(address t, uint256 d) { token = IERC20(t); DENOMINATION = d; }
    function deposit(uint256) external pure { revert("Pool rejected the note"); }
}` },
    'contracts/Token6.sol': { content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
contract Token6 is ERC20 {
    constructor() ERC20("Test6", "T6") { _mint(msg.sender, 1_000_000_000 * 10 ** 6); }
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
  const C = { Pool5: K('V5.sol', 'LatheonShieldedPoolV5'), Dist: K('Dist.sol', 'LatheonDistributionPool'), Poseidon: K('PoseidonT3.sol', 'PoseidonT3'),
    Token: K('Token.sol', 'LatheonToken'), Ver5: K('VerifierV5.sol', 'Groth16Verifier'), Token6: K('Token6.sol', 'Token6'), Rejecting: K('Rejecting.sol', 'RejectingPool') };

  const link = (c, libs) => {
    let code = c.evm.bytecode.object; const refs = c.evm.bytecode.linkReferences;
    for (const f in refs) for (const l in refs[f]) for (const { start, length } of refs[f][l])
      code = code.slice(0, start * 2) + libs[l].slice(2).toLowerCase() + code.slice(start * 2 + length * 2);
    return code;
  };

  const gp = ganache.provider({ logging: { quiet: true }, chain: { hardfork: 'shanghai' }, wallet: { deterministic: true, totalAccounts: 8 }, miner: { blockGasLimit: 60000000 } });
  const provider = new ethers.BrowserProvider(gp);
  const signers = await Promise.all([0, 1, 2, 3, 4, 5, 6, 7].map((i) => provider.getSigner(i)));
  const [deployer, relayer, rec1, rec2, rec3, poor] = signers;
  const [deployerAddr, rec1Addr, rec2Addr, rec3Addr, poorAddr] = await Promise.all([deployer, rec1, rec2, rec3, poor].map((s) => s.getAddress()));

  const deploy = async (c, args = [], libs = {}) => {
    const f = new ethers.ContractFactory(c.abi, '0x' + link(c, libs), deployer);
    const x = await f.deploy(...args); await x.waitForDeployment(); return x;
  };
  const reason = async (fn) => { try { await fn(); return { reverted: false, msg: '' }; } catch (e) { return { reverted: true, msg: [e.reason, e.shortMessage, e.message].filter(Boolean).join(' | ') }; } };
  const failsWith = (r, text) => r.reverted && r.msg.includes(text);

  const lib = await deploy(C.Poseidon); const libs = { PoseidonT3: await lib.getAddress() };
  const ver5 = await deploy(C.Ver5);
  const lth = await deploy(C.Token, [deployerAddr]);
  const tok6 = await deploy(C.Token6);
  const addr = (c) => c.getAddress();

  // one fixed pool per denomination for a token
  const makePools = async (token, denoms) => Promise.all(denoms.map(async (d) => deploy(C.Pool5, [await addr(token), await addr(ver5), d], libs)));
  const D18 = [100n * E18, 50n * E18, 10n * E18, 1n * E18];
  const D6 = [100n * E6, 50n * E6, 10n * E6, 1n * E6];
  const pools = await makePools(lth, D18);
  const poolAddrs = await Promise.all(pools.map(addr));
  const dist = await deploy(C.Dist, [await addr(lth), poolAddrs]);
  const distAddr = await addr(dist);

  const newNote = () => { const sk = rnd(), vk = rnd(); return { sk, vk, commitment: poseidon2([poseidon2([sk, vk]), 0n]) }; };
  const notesFor = (n) => Array.from({ length: Number(n) }, newNote);
  const nextIdx = async () => Promise.all(pools.map(async (p) => Number(await p.nextIndex())));
  const poolBals = async (token, ps) => Promise.all(ps.map(async (p) => token.balanceOf(await addr(p))));

  // a proof for a pool that holds exactly one deposit (leaf 0), bound to `recipient`
  const w3 = path.join(V3, 'withdraw_v3.wasm'), z3 = path.join(V3, 'withdraw_v3_final.zkey');
  async function proofFor(pool, note, recipientAddr) {
    const zeros = []; for (let i = 0; i < 8; i++) zeros.push((await pool.zeros(i)).toString());
    const root = await pool.roots(await pool.currentRootIndex());
    const input = { root: root.toString(), nullifierHash: poseidon2([note.sk, 1n]).toString(), spendKey: note.sk.toString(), viewKey: note.vk.toString(),
      pathElements: zeros, pathIndices: new Array(8).fill(0), recipient: BigInt(recipientAddr).toString() };
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, w3, z3);
    const [pA, pB, pC, pub] = JSON.parse('[' + (await snarkjs.groth16.exportSolidityCallData(proof, publicSignals)) + ']');
    return { pA, pB, pC, root: pub[0], nullifier: pub[1] };
  }

  // ------------------------------------------------------------------ split
  console.log('\nsplit');
  const vectors = [[1n, [0, 0, 0, 1]], [9n, [0, 0, 0, 9]], [10n, [0, 0, 1, 0]], [60n, [0, 1, 1, 0]], [99n, [0, 1, 4, 9]], [160n, [1, 1, 1, 0]], [250n, [2, 1, 0, 0]], [3200n, [32, 0, 0, 0]]];
  let vecOk = true;
  for (const [tokens, expected] of vectors) {
    const [counts, total] = await dist.split(tokens * E18);
    const js = canonicalSplit(tokens * E18, D18);
    const same = counts.every((c, i) => c === BigInt(expected[i])) && total === BigInt(expected.reduce((a, b) => a + b, 0));
    const mirror = js.counts.every((c, i) => c === counts[i]) && js.total === total;
    if (!same || !mirror) { vecOk = false; console.log('   mismatch for', tokens.toString(), counts.map(String), expected); }
  }
  rec('split: known amounts give the documented canonical notes (contract and client mirror agree)', vecOk, vectors.length + ' amounts');
  let randOk = true;
  for (let i = 0; i < 300; i++) {
    const a = (BigInt(1 + Math.floor(Math.random() * 5000))) * E18;
    const [counts, total] = await dist.split(a); const js = canonicalSplit(a, D18);
    const sum = counts.reduce((s, c, j) => s + c * D18[j], 0n);
    if (!(js.counts.every((c, j) => c === counts[j]) && js.total === total && sum === a)) { randOk = false; break; }
  }
  rec('split: 300 random amounts: contract equals mirror, and the notes add up to exactly the amount', randOk, '');
  const z = await reason(() => dist.split(0n));
  rec('split: zero amount is rejected', failsWith(z, 'Zero amount'), '');
  const off = await reason(() => dist.split(E18 + E18 / 2n));
  rec('split: an amount that is not a multiple of the smallest denomination is rejected', failsWith(off, 'not a multiple'), '');
  rec('mirror: roundDown keeps the remainder out of the deposit (decision D3)', roundDown(1234n * E18 + 7n, 10n * E18) === 1230n * E18, '');

  // ------------------------------------------------------------------ deposit 160 = 100 + 50 + 10
  console.log('\ndeposit and composability (160 tokens = 100 + 50 + 10)');
  const gasRows = [];
  const idx0 = await nextIdx(), pb0 = await poolBals(lth, pools), user0 = await lth.balanceOf(deployerAddr);
  const notes160 = notesFor(3);
  await (await lth.approve(distAddr, 160n * E18)).wait();
  const r160 = await (await dist.deposit(160n * E18, notes160.map((n) => n.commitment))).wait();
  gasRows.push([3, r160.gasUsed]);
  const idx1 = await nextIdx(), pb1 = await poolBals(lth, pools);
  rec('deposit: one note landed in each of the 100 / 50 / 10 pools, none in the 1 pool', idx1.every((v, i) => v - idx0[i] === [1, 1, 1, 0][i]), 'next indices +' + idx1.map((v, i) => v - idx0[i]).join('/'));
  rec('deposit: each pool holds exactly its denomination more; the router holds nothing', pb1.every((b, i) => b - pb0[i] === [100n, 50n, 10n, 0n][i] * E18) && (await lth.balanceOf(distAddr)) === 0n, '');
  rec('deposit: the user paid exactly the amount', user0 - (await lth.balanceOf(deployerAddr)) === 160n * E18, '');
  let allowZero = true; for (const a of poolAddrs) if ((await lth.allowance(distAddr, a)) !== 0n) allowZero = false;
  rec('deposit: the router has no allowance left over any pool', allowZero && (await lth.allowance(deployerAddr, distAddr)) === 0n, '');
  const seen = []; for (const log of r160.logs) { const i = poolAddrs.findIndex((a) => a.toLowerCase() === log.address.toLowerCase()); if (i >= 0) { const ev = pools[i].interface.parseLog(log); if (ev && ev.name === 'Deposit') seen.push(ev.args.commitment); } }
  rec('deposit: the pools\' Deposit events carry the commitments in the documented order (largest pool first)', seen.length === 3 && seen.every((c, i) => c === notes160[i].commitment), '');
  const distEv = r160.logs.map((l) => { try { return dist.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === 'Distributed');
  rec('deposit: the Distributed event reports depositor, amount and number of notes', !!distEv && distEv.args.depositor === deployerAddr && distEv.args.amount === 160n * E18 && distEv.args.notes === 3n, '');

  // every note is an ordinary V5 note, taken out to a different address, in parts
  const targets = [rec1Addr, rec2Addr, rec3Addr];
  const wd = [];
  for (let i = 0; i < 3; i++) {
    const p = await proofFor(pools[i], notes160[i], targets[i]);
    const before = await lth.balanceOf(targets[i]);
    await (await pools[i].connect(relayer).withdraw(p.pA, p.pB, p.pC, p.root, p.nullifier, targets[i])).wait();
    wd.push((await lth.balanceOf(targets[i])) - before);
  }
  rec('composable: the three notes are withdrawn with the ordinary V5 withdraw() to three different addresses (100 / 50 / 10)', wd[0] === 100n * E18 && wd[1] === 50n * E18 && wd[2] === 10n * E18, wd.map((x) => x / E18).join(' / '));
  const wdMid = await poolBals(lth, pools);
  rec('composable: after that the pools are empty again (nothing was stuck in the router)', wdMid.every((b) => b === 0n) && (await lth.balanceOf(distAddr)) === 0n, '');

  // withdrawing only SOME of the notes leaves the others available
  const notesP = notesFor(2);
  await (await lth.approve(distAddr, 150n * E18)).wait();
  await (await dist.deposit(150n * E18, notesP.map((n) => n.commitment))).wait();    // 100 + 50 (pools hold one note each, leaf 1)
  const idxP = await nextIdx();
  rec('composable: 150 = 100 + 50 lands as two notes', idxP[0] - idx1[0] === 1 && idxP[1] - idx1[1] === 1, '');

  // ------------------------------------------------------------------ mixed amount, many notes, gas
  console.log('\nmany notes and gas');
  const mixIdx = await nextIdx();
  const n99 = notesFor(14);
  await (await lth.approve(distAddr, 99n * E18)).wait();
  const r99 = await (await dist.deposit(99n * E18, n99.map((n) => n.commitment))).wait();
  gasRows.push([14, r99.gasUsed]);
  const mixIdx1 = await nextIdx();
  rec('99 tokens -> 1 x 50, 4 x 10, 9 x 1 (14 notes), each in its pool', mixIdx1.every((v, i) => v - mixIdx[i] === [0, 1, 4, 9][i]), 'next indices +' + mixIdx1.map((v, i) => v - mixIdx[i]).join('/'));
  const order = noteOrder(canonicalSplit(99n * E18, D18).counts, D18);
  rec('mirror: noteOrder lists the 14 notes in the order the contract consumes commitments', order.length === 14 && order.slice(0, 1)[0] === 50n * E18 && order[1] === 10n * E18 && order[13] === 1n * E18, '');
  for (const [tokens, count] of [[1n, 1], [10n, 1], [3200n, 32]]) {
    const ns = notesFor(count);
    await (await lth.approve(distAddr, tokens * E18)).wait();
    const r = await (await dist.deposit(tokens * E18, ns.map((n) => n.commitment))).wait();
    if (!gasRows.some((g) => g[0] === count)) gasRows.push([count, r.gasUsed]);
  }
  gasRows.sort((a, b) => a[0] - b[0]);
  console.log('   gas for one deposit() call (local EVM):');
  for (const [n, g] of gasRows) console.log(`     ${String(n).padStart(2)} note(s): ${String(g).padStart(9)} gas  (${Math.round(Number(g) / n)} per note)`);
  const g32 = gasRows.find((r) => r[0] === 32)[1];
  rec('32 notes (MAX_NOTES) fit comfortably in one transaction (< 30M gas)', g32 < 30_000_000n, g32.toString() + ' gas');
  const n33 = notesFor(33);
  await (await lth.approve(distAddr, 3300n * E18)).wait();
  const tooMany = await reason(() => dist.deposit.staticCall(3300n * E18, n33.map((n) => n.commitment)));
  rec('33 notes are refused ("Too many notes")', failsWith(tooMany, 'Too many notes'), '');

  // ------------------------------------------------------------------ withdrawMany
  console.log('\nwithdrawMany (several notes, one transaction)');
  const sameJson = (x, y) => JSON.stringify(x, (k, v) => (typeof v === 'bigint' ? v.toString() : v)) === JSON.stringify(y, (k, v) => (typeof v === 'bigint' ? v.toString() : v));
  const fresh = async () => {   // a fresh set of pools + router, so every pool holds exactly one deposit at leaf 0
    const ps = await makePools(lth, D18); const pa = await Promise.all(ps.map(addr));
    const d = await deploy(C.Dist, [await addr(lth), pa]);
    const ns = notesFor(3);
    await (await lth.approve(await addr(d), 160n * E18)).wait();
    await (await d.deposit(160n * E18, ns.map((n) => n.commitment))).wait();
    return { ps, pa, d, ns };
  };
  const itemFor = async (f, i, recipient) => { const pr = await proofFor(f.ps[i], f.ns[i], recipient); return { pool: i, pA: pr.pA, pB: pr.pB, pC: pr.pC, root: pr.root, nullifierHash: pr.nullifier }; };
  const wmRefuse = async (f, items, recipient, text) => {
    const st = await reason(() => f.d.connect(relayer).withdrawMany.staticCall(items, recipient));
    const real = await reason(async () => { const rc = await (await f.d.connect(relayer).withdrawMany(items, recipient, { gasLimit: 12_000_000 })).wait(); if (rc.status === 0) throw new Error('status 0'); });
    return { textOk: st.msg.includes(text), reverted: st.reverted && real.reverted, note: st.msg.slice(0, 60) };
  };

  const fa = await fresh();
  const itemsA = [await itemFor(fa, 0, rec1Addr), await itemFor(fa, 1, rec1Addr), await itemFor(fa, 2, rec1Addr)];
  const balA0 = await lth.balanceOf(rec1Addr);
  const rcA = await (await fa.d.connect(relayer).withdrawMany(itemsA, rec1Addr)).wait();   // sent by a third party, not by the note owner
  rec('withdrawMany: three notes from three pools are paid out in ONE transaction (100 + 50 + 10 = 160)', (await lth.balanceOf(rec1Addr)) - balA0 === 160n * E18, 'gas ' + rcA.gasUsed + ' (' + (rcA.gasUsed / 3n) + ' per note)');
  rec('withdrawMany: the pools are empty again and the router holds nothing', (await poolBals(lth, fa.ps)).every((b) => b === 0n) && (await lth.balanceOf(await addr(fa.d))) === 0n, '');
  const evA = rcA.logs.map((l) => { try { return fa.d.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === 'WithdrawnMany');
  rec('withdrawMany: the WithdrawnMany event reports recipient and number of notes', !!evA && evA.args.recipient === rec1Addr && evA.args.notes === 3n, '');
  let spentAll = true; for (let i = 0; i < 3; i++) if (!(await fa.ps[i].nullifierHashes(itemsA[i].nullifierHash))) spentAll = false;
  rec('withdrawMany: every nullifier is marked spent in its own pool', spentAll, '');

  // only some of the notes: the rest stay available through the ordinary withdraw()
  const fb = await fresh();
  const itemsB = [await itemFor(fb, 0, rec2Addr), await itemFor(fb, 2, rec2Addr)];
  const balB0 = await lth.balanceOf(rec2Addr);
  await (await fb.d.connect(relayer).withdrawMany(itemsB, rec2Addr)).wait();
  const restB = await proofFor(fb.ps[1], fb.ns[1], rec3Addr);
  const balB3 = await lth.balanceOf(rec3Addr);
  await (await fb.ps[1].connect(relayer).withdraw(restB.pA, restB.pB, restB.pC, restB.root, restB.nullifier, rec3Addr)).wait();
  rec('withdrawMany: taking only 2 of 3 notes leaves the third intact; it is then withdrawn with the ordinary withdraw()',
    (await lth.balanceOf(rec2Addr)) - balB0 === 110n * E18 && (await lth.balanceOf(rec3Addr)) - balB3 === 50n * E18, '110 + 50');

  // atomic: one spent note makes the whole batch revert, the others stay untouched and spendable
  const fc = await fresh();
  const spentFirst = await proofFor(fc.ps[1], fc.ns[1], rec1Addr);
  await (await fc.ps[1].connect(relayer).withdraw(spentFirst.pA, spentFirst.pB, spentFirst.pC, spentFirst.root, spentFirst.nullifier, rec1Addr)).wait();
  const itemsC = [await itemFor(fc, 0, rec1Addr), await itemFor(fc, 1, rec1Addr), await itemFor(fc, 2, rec1Addr)];
  const snapC = async () => ({ bal: await poolBals(lth, fc.ps), rec: await lth.balanceOf(rec1Addr) });
  const c0 = await snapC();
  const rC = await wmRefuse(fc, itemsC, rec1Addr, 'Note already spent');
  rec('withdrawMany: one already spent note makes the whole batch revert ("Note already spent"), nothing is paid', rC.textOk && rC.reverted && sameJson(c0, await snapC()), rC.note);
  const okC = [itemsC[0], itemsC[2]];
  await (await fc.d.connect(relayer).withdrawMany(okC, rec1Addr)).wait();
  rec('withdrawMany: after the refusal the other two notes are still spendable (110 paid)', (await lth.balanceOf(rec1Addr)) - c0.rec === 110n * E18, '');

  // a proof is bound to its recipient: the router cannot redirect the money
  const fd = await fresh();
  const itemsD = [await itemFor(fd, 0, rec1Addr), await itemFor(fd, 1, rec1Addr)];
  const d0 = { bal: await poolBals(lth, fd.ps), r2: await lth.balanceOf(rec2Addr) };
  const rD = await wmRefuse(fd, itemsD, rec2Addr, 'Invalid proof');
  rec('withdrawMany: proofs made for one address do not pay another ("Invalid proof")', rD.textOk && rD.reverted && sameJson(d0, { bal: await poolBals(lth, fd.ps), r2: await lth.balanceOf(rec2Addr) }), rD.note);
  const rD2 = await wmRefuse(fd, itemsD, ethers.ZeroAddress, 'Zero recipient');
  rec('withdrawMany: the zero address is refused ("Zero recipient")', rD2.textOk && rD2.reverted, rD2.note);

  // malformed batches
  const rE1 = await wmRefuse(fd, [], rec1Addr, 'No withdrawals');
  rec('withdrawMany: an empty list is refused ("No withdrawals")', rE1.textOk && rE1.reverted, '');
  const rE2 = await wmRefuse(fd, [{ ...itemsD[0], pool: 4 }], rec1Addr, 'Unknown pool');
  rec('withdrawMany: a pool index outside 0..3 is refused ("Unknown pool")', rE2.textOk && rE2.reverted, '');
  const rE3 = await wmRefuse(fd, [itemsD[0], itemsD[0]], rec1Addr, 'Note already spent');
  rec('withdrawMany: the same note twice in one batch is refused ("Note already spent")', rE3.textOk && rE3.reverted, '');
  const rE4 = await wmRefuse(fd, Array.from({ length: 17 }, () => itemsD[0]), rec1Addr, 'Too many withdrawals');
  rec('withdrawMany: more than MAX_WITHDRAWALS (16) items are refused ("Too many withdrawals")', rE4.textOk && rE4.reverted, '');
  rec('withdrawMany: after all of those refusals the notes of that set are untouched', sameJson(d0.bal, await poolBals(lth, fd.ps)), '');

  // ------------------------------------------------------------------ refusals
  console.log('\nrefusals (state must stay untouched)');
  const snap = async () => ({ idx: await nextIdx(), bal: await poolBals(lth, pools), user: await lth.balanceOf(deployerAddr), router: await lth.balanceOf(distAddr) });
  const same = (a, b) => JSON.stringify(a, (k, v) => (typeof v === 'bigint' ? v.toString() : v)) === JSON.stringify(b, (k, v) => (typeof v === 'bigint' ? v.toString() : v));
  await (await lth.approve(distAddr, 1000n * E18)).wait();
  let s0 = await snap();
  // The reason text comes from a static call (a plain transaction hides it behind a failed gas estimate);
  // then the REAL transaction is sent with a fixed gas limit and must revert, leaving the state untouched.
  const refuse = async (caller, amount, commitments, text) => {
    const st = await reason(() => caller.deposit.staticCall(amount, commitments));
    const real = await reason(async () => { const tx = await caller.deposit(amount, commitments, { gasLimit: 12_000_000 }); const rc = await tx.wait(); if (rc.status === 0) throw new Error('status 0'); });
    return { textOk: text ? st.msg.includes(text) : st.reverted, reverted: st.reverted && real.reverted, note: st.msg.slice(0, 50) };
  };
  const check = (name, r) => rec(name, r.textOk && r.reverted, r.note);
  const dupNote = newNote();
  let r = await refuse(dist, 160n * E18, notesFor(2).map((n) => n.commitment), 'Wrong number of commitments');
  let r2 = await refuse(dist, 160n * E18, notesFor(4).map((n) => n.commitment), 'Wrong number of commitments');
  rec('too few or too many commitments are refused ("Wrong number of commitments"), state untouched', r.textOk && r.reverted && r2.textOk && r2.reverted && same(s0, await snap()), '');
  check('the same commitment twice is refused ("Duplicate commitment")', await refuse(dist, 20n * E18, [dupNote.commitment, dupNote.commitment], 'Duplicate commitment'));
  check('zero amount is refused ("Zero amount")', await refuse(dist, 0n, [], 'Zero amount'));
  check('an amount off the denomination grid is refused', await refuse(dist, E18 + 1n, [newNote().commitment], 'not a multiple'));
  rec('after all of those the pools, the user and the router are exactly as before', same(s0, await snap()), '');
  await (await lth.approve(distAddr, 0n)).wait();
  check('no allowance: refused', await refuse(dist, 10n * E18, [newNote().commitment], null));
  await (await lth.connect(poor).approve(distAddr, 1000n * E18)).wait();
  check('no balance: refused', await refuse(dist.connect(poor), 10n * E18, [newNote().commitment], null));
  rec('and again nothing moved', same(s0, await snap()), '');

  // atomicity: if one pool rejects its note, notes already placed in other pools are rolled back too
  console.log('\natomicity');
  const rej = await deploy(C.Rejecting, [await addr(lth), E18]);
  const mdist = await deploy(C.Dist, [await addr(lth), [poolAddrs[0], poolAddrs[1], poolAddrs[2], await addr(rej)]]);
  const mAddr = await addr(mdist);
  await (await lth.approve(mAddr, 111n * E18)).wait();
  const m0 = await snap();
  const rj = await refuse(mdist, 111n * E18, notesFor(3).map((n) => n.commitment), 'Pool rejected the note');   // 100 + 10 + 1: the last pool rejects
  let mClean = (await lth.balanceOf(mAddr)) === 0n;
  for (const a of poolAddrs) if ((await lth.allowance(mAddr, a)) !== 0n) mClean = false;
  rec('a rejecting pool rolls the whole call back: the 100 and 10 notes already placed are not left behind', rj.textOk && rj.reverted && same(m0, await snap()) && mClean, rj.note);

  if (process.env.FULL_TREE) {
    console.log('   FULL_TREE=1: filling a real pool to its 256-note capacity (takes a long time)');
    const apools = await makePools(lth, D18);
    const apoolAddrs = await Promise.all(apools.map(addr));
    const adist = await deploy(C.Dist, [await addr(lth), apoolAddrs]);
    await (await lth.approve(await addr(adist), 252n * E18)).wait();
    for (let i = 0; i < 28; i++) await (await adist.deposit(9n * E18, notesFor(9).map((n) => n.commitment))).wait();   // 252 notes in the 1-pool
    await (await lth.approve(apoolAddrs[3], 4n * E18)).wait();
    for (let i = 0; i < 4; i++) await (await apools[3].deposit(rnd())).wait();                                       // 256: full
    rec('real tree: the 1-pool is full (256 notes)', Number(await apools[3].nextIndex()) === 256, '');
    const aSnap = async () => ({ idx: await Promise.all(apools.map(async (p) => Number(await p.nextIndex()))), bal: await poolBals(lth, apools), user: await lth.balanceOf(deployerAddr), router: await lth.balanceOf(await addr(adist)) });
    const a0 = await aSnap();
    await (await lth.approve(await addr(adist), 111n * E18)).wait();
    const full = await refuse(adist, 111n * E18, notesFor(3).map((n) => n.commitment), 'Tree is full');            // 100 + 10 + 1: the 1-pool is full
    rec('real tree: a full pool rolls the whole call back ("Tree is full"), the 100 and 10 notes are not left behind', full.textOk && full.reverted && same(a0, await aSnap()), full.note);
  }

  // ------------------------------------------------------------------ constructor
  console.log('\nconstructor');
  const ctor = async (token, addrs) => {
    const f = new ethers.ContractFactory(C.Dist.abi, '0x' + link(C.Dist, libs), deployer);
    const tx = await f.getDeployTransaction(await addr(token), addrs);
    return reason(() => provider.call({ data: tx.data }));
  };
  const pools6 = await makePools(tok6, D6);
  const p6 = await Promise.all(pools6.map(addr));
  const mix = await ctor(lth, [poolAddrs[0], poolAddrs[1], poolAddrs[2], p6[3]]);
  rec('a pool of another token is rejected ("Pool token mismatch")', failsWith(mix, 'Pool token mismatch'), '');
  const wrongOrder = await ctor(lth, [poolAddrs[1], poolAddrs[0], poolAddrs[2], poolAddrs[3]]);
  rec('denominations out of order are rejected', failsWith(wrongOrder, 'descending and divide'), '');
  const three = await deploy(C.Pool5, [await addr(lth), await addr(ver5), 3n * E18], libs);
  const noDiv = await ctor(lth, [poolAddrs[0], poolAddrs[1], poolAddrs[2], await addr(three)]);
  rec('a denomination that does not divide the previous one (10 then 3) is rejected', failsWith(noDiv, 'descending and divide'), '');
  const zeroPool = await ctor(lth, [ethers.ZeroAddress, poolAddrs[1], poolAddrs[2], poolAddrs[3]]);
  rec('a zero pool address is rejected', failsWith(zeroPool, 'Zero pool'), '');

  // ------------------------------------------------------------------ 6 decimals
  console.log('\n6-decimals token (USDG-like)');
  const dist6 = await deploy(C.Dist, [await addr(tok6), p6]);
  const [c6] = await dist6.split(61n * E6);
  rec('split of 61 USDG-like tokens = 50 + 10 + 1', c6.every((c, i) => c === BigInt([0, 1, 1, 1][i])), '');
  const n6 = notesFor(3), b6 = await poolBals(tok6, pools6);
  await (await tok6.approve(await addr(dist6), 61n * E6)).wait();
  await (await dist6.deposit(61n * E6, n6.map((n) => n.commitment))).wait();
  const a6 = await poolBals(tok6, pools6);
  rec('the 6-decimals deposit lands as 0 / 50 / 10 / 1 tokens in the four pools', a6.every((b, i) => b - b6[i] === [0n, 50n, 10n, 1n][i] * E6), '');
  const p = await proofFor(pools6[1], n6[0], rec1Addr);
  const bw = await tok6.balanceOf(rec1Addr);
  await (await pools6[1].connect(relayer).withdraw(p.pA, p.pB, p.pC, p.root, p.nullifier, rec1Addr)).wait();
  rec('and its 50 note is withdrawn with the ordinary V5 withdraw()', (await tok6.balanceOf(rec1Addr)) - bw === 50n * E6, '');

  const ok = results.every(Boolean);
  console.log('\n' + (ok ? `ALL ${results.length} CHECKS PASSED` : `FAILED: ${results.filter((x) => !x).length} of ${results.length}`));
  return ok;
}

main().then((ok) => process.exit(ok ? 0 : 1)).catch((e) => { console.error('ERROR:', e && e.message ? e.message : e); process.exit(1); });
