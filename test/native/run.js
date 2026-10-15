'use strict';
/*
 * Integration tests for the native-coin variants LatheonShieldedPoolV5Native and LatheonDistributionPoolNative,
 * with REAL Groth16 proofs (withdraw_v3), on a local EVM. Same circuit, verifier, tree and recipient binding as V5;
 * the pools take and pay the chain's native coin instead of an ERC-20.
 *
 * What is checked
 *   pool        - exact amount only; a proof pays only its own recipient; double spend; zero recipient; Poseidon link
 *   transfers   - a recipient that refuses the coin: the withdrawal reverts and the note stays spendable;
 *                 a recipient that re-enters withdraw() while being paid: paid once, re-entry refused;
 *                 coin forced in with selfdestruct changes nothing; plain transfers to pool and router are refused
 *   split       - the on-chain rule equals the client mirror (sdk/distribution.js) for known and random amounts
 *   deposit     - msg.value must equal amount; canonical notes in the right pools; router holds nothing; events
 *   composable  - every note is withdrawn with the ordinary withdraw() to a different address
 *   withdrawMany- one transaction for several notes; partial; atomic on a spent note; recipient binding; malformed
 *   refusals    - wrong number of commitments, duplicates, zero, off-grid, too many notes; state untouched
 *   atomicity   - a rejecting pool rolls the whole deposit back
 *   constructor - an ERC-20 pool, wrong order, non-dividing denominations, a zero address
 *   accounting  - every pool holds exactly denomination x (deposits - withdrawals)
 *   gas         - deposit() for 1, 3, 14, 32 notes and withdrawMany() for 1, 2, 3 notes
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
const { canonicalSplit } = require('../../sdk/distribution.js');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(p, 'utf8');
const V3 = path.join(ROOT, 'circuits', 'build', 'withdraw_v3');
const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const E18 = 10n ** 18n;
const D18 = [100n * E18, 50n * E18, 10n * E18, 1n * E18];
const LEVELS = 8;
const rnd = () => BigInt('0x' + crypto.randomBytes(31).toString('hex')) % FIELD;

function findImports(p) {
  const f = path.join(__dirname, 'node_modules', p);
  return fs.existsSync(f) ? { contents: read(f) } : { error: 'not found: ' + p };
}

const DOUBLES = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
interface IW { function withdraw(uint256[2] calldata, uint256[2][2] calldata, uint256[2] calldata, uint256, uint256, address) external; }
struct Item { uint256 pool; uint256[2] pA; uint256[2][2] pB; uint256[2] pC; uint256 root; uint256 nullifierHash; }
interface IR { function withdrawMany(Item[] calldata, address) external; }
// Test double: refuses the native coin.
contract RefusingRecipient { receive() external payable { revert("no thanks"); } }
// Test double: when paid, tries to withdraw the same note again through the pool (same proof, same nullifier).
contract ReenteringRecipient {
    IW pool; uint256[2] a; uint256[2][2] b; uint256[2] c; uint256 root; uint256 nh; bool armed;
    uint256 public payments; bool public reentrySucceeded; string public reentryError;
    function arm(address p, uint256[2] calldata pA, uint256[2][2] calldata pB, uint256[2] calldata pC, uint256 r, uint256 n) external {
        pool = IW(p); a = pA; b = pB; c = pC; root = r; nh = n; armed = true;
    }
    receive() external payable {
        payments++;
        if (!armed) return;
        armed = false;
        try pool.withdraw(a, b, c, root, nh, address(this)) { reentrySucceeded = true; } catch Error(string memory why) { reentryError = why; }
    }
}
// Test double: when paid, re-enters the ROUTER's withdrawMany with the whole batch it is being paid from.
contract ReenteringRouterRecipient {
    IR router; Item[] items; bool armed;
    uint256 public payments; bool public reentrySucceeded; string public reentryError;
    function arm(address r, Item[] calldata it) external { router = IR(r); delete items; for (uint256 i = 0; i < it.length; i++) items.push(it[i]); armed = true; }
    receive() external payable {
        payments++;
        if (!armed) return;
        armed = false;
        try router.withdrawMany(items, address(this)) { reentrySucceeded = true; } catch Error(string memory why) { reentryError = why; }
    }
}
// Test double: looks like a native pool but rejects every note (atomicity of the router).
contract RejectingNativePool {
    uint256 public DENOMINATION;
    constructor(uint256 d) { DENOMINATION = d; }
    function token() external pure returns (address) { return address(0); }
    function deposit(uint256) external payable { revert("Pool rejected the note"); }
}
// Test double: forces coin into an address with selfdestruct (no receive() can stop it).
contract ForceSend { constructor(address payable to) payable { selfdestruct(to); } }
`;

async function main() {
  const results = [];
  const rec = (name, ok, note) => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (note ? '   [' + note + ']' : '')); };

  console.log('Compiling contracts from this repository...');
  const sources = {
    'contracts/PoolNative.sol': { content: read(path.join(ROOT, 'contracts', 'LatheonShieldedPoolV5Native.sol')) },
    'contracts/DistNative.sol': { content: read(path.join(ROOT, 'contracts', 'LatheonDistributionPoolNative.sol')) },
    'contracts/V5.sol': { content: read(path.join(ROOT, 'contracts', 'LatheonShieldedPoolV5.sol')) },
    'contracts/PoseidonT3.sol': { content: read(path.join(ROOT, 'contracts', 'PoseidonT3.sol')) },
    'contracts/Token.sol': { content: read(path.join(ROOT, 'contracts', 'LatheonToken.sol')) },
    'contracts/VerifierV5.sol': { content: read(path.join(ROOT, 'contracts', 'WithdrawVerifierV3.sol')) },
    'contracts/Doubles.sol': { content: DOUBLES },
  };
  const out = JSON.parse(solc.compile(JSON.stringify({
    language: 'Solidity', sources,
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.bytecode.linkReferences'] } } },
  }), { import: findImports }));
  const errors = (out.errors || []).filter((e) => e.severity === 'error');
  if (errors.length) { errors.forEach((e) => console.log(e.formattedMessage)); throw new Error('compilation failed'); }
  const K = (f, n) => out.contracts['contracts/' + f][n];
  const C = { Pool: K('PoolNative.sol', 'LatheonShieldedPoolV5Native'), Dist: K('DistNative.sol', 'LatheonDistributionPoolNative'),
    Pool5: K('V5.sol', 'LatheonShieldedPoolV5'), Poseidon: K('PoseidonT3.sol', 'PoseidonT3'), Token: K('Token.sol', 'LatheonToken'),
    Ver5: K('VerifierV5.sol', 'Groth16Verifier'), Refusing: K('Doubles.sol', 'RefusingRecipient'), Reenter: K('Doubles.sol', 'ReenteringRecipient'),
    ReenterRouter: K('Doubles.sol', 'ReenteringRouterRecipient'), Rejecting: K('Doubles.sol', 'RejectingNativePool'), Force: K('Doubles.sol', 'ForceSend') };

  const link = (c, libs) => {
    let code = c.evm.bytecode.object; const refs = c.evm.bytecode.linkReferences;
    for (const f in refs) for (const l in refs[f]) for (const { start, length } of refs[f][l])
      code = code.slice(0, start * 2) + libs[l].slice(2).toLowerCase() + code.slice(start * 2 + length * 2);
    return code;
  };

  const gp = ganache.provider({ logging: { quiet: true }, chain: { hardfork: 'shanghai' },
    wallet: { deterministic: true, totalAccounts: 8, defaultBalance: 1_000_000 }, miner: { blockGasLimit: 60000000 } });
  const provider = new ethers.BrowserProvider(gp);
  const signers = await Promise.all([0, 1, 2, 3, 4, 5, 6, 7].map((i) => provider.getSigner(i)));
  const [deployer, relayer, , , , poor] = signers;
  const deployerAddr = await deployer.getAddress();
  const bal = (a) => provider.getBalance(a);
  const newAddr = () => ethers.Wallet.createRandom().address;   // fresh, empty recipients

  const deploy = async (c, args = [], libs = {}, value) => {
    const f = new ethers.ContractFactory(c.abi, '0x' + link(c, libs), deployer);
    const x = await f.deploy(...args, ...(value ? [{ value }] : [])); await x.waitForDeployment(); return x;
  };
  const reason = async (fn) => { try { await fn(); return { reverted: false, msg: '' }; } catch (e) { return { reverted: true, msg: [e.reason, e.shortMessage, e.message].filter(Boolean).join(' | ') }; } };
  const failsWith = (r, text) => r.reverted && r.msg.includes(text);
  // Reason from a static call, then the REAL transaction with a fixed gas limit must revert too.
  const refuseTx = async (contract, fn, args, overrides, text) => {
    const st = await reason(() => contract[fn].staticCall(...args, overrides || {}));
    const real = await reason(async () => { const rc = await (await contract[fn](...args, { gasLimit: 12_000_000, ...(overrides || {}) })).wait(); if (rc.status === 0) throw new Error('status 0'); });
    return { ok: (text ? st.msg.includes(text) : st.reverted) && real.reverted, note: st.msg.slice(0, 60) };
  };
  const J = (x) => JSON.stringify(x, (k, v) => (typeof v === 'bigint' ? v.toString() : v));
  const paid = (rc) => rc.gasUsed * (rc.gasPrice || rc.effectiveGasPrice);

  const lib = await deploy(C.Poseidon); const libs = { PoseidonT3: await lib.getAddress() };
  const ver5 = await deploy(C.Ver5); const verAddr = await ver5.getAddress();
  const addr = (c) => c.getAddress();

  // ---- local mirror of each pool's tree (leaves from Deposit events), for proofs at any leaf
  const leaves = new Map();
  const recordDeposits = (rc, pools) => {
    for (const lg of rc.logs) for (const p of pools) {
      if (p.target.toLowerCase() !== lg.address.toLowerCase()) continue;
      const ev = p.interface.parseLog(lg);
      if (ev && ev.name === 'Deposit') { const k = p.target.toLowerCase(); if (!leaves.has(k)) leaves.set(k, []); leaves.get(k)[Number(ev.args.leafIndex)] = ev.args.commitment; }
    }
  };
  const w3 = path.join(V3, 'withdraw_v3.wasm'), z3 = path.join(V3, 'withdraw_v3_final.zkey');
  async function proofFor(pool, note, recipient) {
    const L = leaves.get(pool.target.toLowerCase()) || [];
    const leaf = L.indexOf(note.commitment);
    if (leaf < 0) throw new Error('note not in pool');
    const zeros = []; for (let i = 0; i < LEVELS; i++) zeros.push(await pool.zeros(i));
    const levels = [L.slice()];
    for (let l = 0; l < LEVELS; l++) {
      const cur = levels[l], up = [];
      for (let j = 0; j < Math.max(1, Math.ceil(cur.length / 2)); j++) up.push(poseidon2([cur[2 * j] ?? zeros[l], cur[2 * j + 1] ?? zeros[l]]));
      levels.push(up);
    }
    const el = [], idx = []; let k = leaf;
    for (let l = 0; l < LEVELS; l++) { el.push((levels[l][k ^ 1] ?? zeros[l]).toString()); idx.push(k & 1); k >>= 1; }
    const input = { root: levels[LEVELS][0].toString(), nullifierHash: poseidon2([note.sk, 1n]).toString(), recipient: BigInt(recipient).toString(),
      spendKey: note.sk.toString(), viewKey: note.vk.toString(), pathElements: el, pathIndices: idx };
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, w3, z3);
    const [pA, pB, pC, pub] = JSON.parse('[' + (await snarkjs.groth16.exportSolidityCallData(proof, publicSignals)) + ']');
    return { pA, pB, pC, root: pub[0], nullifier: pub[1], pub };
  }

  const newNote = () => { const sk = rnd(), vk = rnd(); return { sk, vk, commitment: poseidon2([poseidon2([sk, vk]), 0n]) }; };
  const notesFor = (n) => Array.from({ length: Number(n) }, newNote);
  const makePools = async () => Promise.all(D18.map((d) => deploy(C.Pool, [verAddr, d], libs)));
  const makeSet = async () => { const ps = await makePools(); const d = await deploy(C.Dist, [await Promise.all(ps.map(addr))]); return { ps, d }; };
  const nextIdx = async (ps) => Promise.all(ps.map(async (p) => Number(await p.nextIndex())));
  const poolBals = async (ps) => Promise.all(ps.map((p) => bal(p.target)));
  const depositVia = async (set, amount, notes, from = deployer) => {
    const rc = await (await set.d.connect(from).deposit(amount, notes.map((n) => n.commitment), { value: amount })).wait();
    recordDeposits(rc, set.ps); return rc;
  };
  const poolDeposit = async (pool, note, from = deployer) => {
    const rc = await (await pool.connect(from).deposit(note.commitment, { value: await pool.DENOMINATION() })).wait();
    recordDeposits(rc, [pool]); return rc;
  };

  // ------------------------------------------------------------------ pool
  console.log('\npool (native coin)');
  const main = await makeSet();
  const [P100, P50, P10, P1] = main.ps;
  const ZERO_TOP = 21551820661461729022865262380882070649935529853313286572328683688269863701601n;
  rec('every pool: zeros(8) is the Poseidon cascade (library linked correctly), token() is address(0)',
    (await Promise.all(main.ps.map((p) => p.zeros(8)))).every((z) => z === ZERO_TOP) && (await Promise.all(main.ps.map((p) => p.token()))).every((t) => t === ethers.ZeroAddress), '');
  let r = await refuseTx(P1, 'deposit', [newNote().commitment], { value: E18 - 1n }, 'Wrong amount');
  let r2 = await refuseTx(P1, 'deposit', [newNote().commitment], { value: E18 + 1n }, 'Wrong amount');
  let r3 = await refuseTx(P1, 'deposit', [newNote().commitment], { value: 0n }, 'Wrong amount');
  rec('deposit: less, more or nothing instead of the denomination is refused ("Wrong amount")', r.ok && r2.ok && r3.ok, r.note);
  const zeroDen = await reason(async () => provider.call({ data: (await new ethers.ContractFactory(C.Pool.abi, '0x' + link(C.Pool, libs), deployer).getDeployTransaction(verAddr, 0n)).data }));
  rec('constructor: zero denomination is refused', failsWith(zeroDen, 'Denomination must be positive'), '');

  const nA = newNote();
  const depA = await poolDeposit(P1, nA);
  rec('deposit: exactly the denomination is accepted; the pool holds it', (await bal(P1.target)) === E18 && Number(await P1.nextIndex()) === 1, 'gas ' + depA.gasUsed);
  const ra = newAddr(), rb = newAddr();
  const prA = await proofFor(P1, nA, ra);
  rec('proof: three public signals, the third is the recipient', prA.pub.length === 3 && BigInt(prA.pub[2]) === BigInt(ra), '');
  const steal = await refuseTx(P1.connect(relayer), 'withdraw', [prA.pA, prA.pB, prA.pC, prA.root, prA.nullifier, rb], null, 'Invalid proof');
  rec('withdraw: a proof made for one address cannot pay another ("Invalid proof")', steal.ok && (await bal(rb)) === 0n, steal.note);
  const zr = await refuseTx(P1.connect(relayer), 'withdraw', [prA.pA, prA.pB, prA.pC, prA.root, prA.nullifier, ethers.ZeroAddress], null, 'Zero recipient');
  rec('withdraw: the zero address is refused ("Zero recipient")', zr.ok, '');
  const ur = await refuseTx(P1.connect(relayer), 'withdraw', [prA.pA, prA.pB, prA.pC, 12345n, prA.nullifier, ra], null, 'Unknown root');
  rec('withdraw: an unknown root is refused ("Unknown root")', ur.ok, '');
  const wA = await (await P1.connect(relayer).withdraw(prA.pA, prA.pB, prA.pC, prA.root, prA.nullifier, ra)).wait();
  rec('withdraw: an empty recipient address receives exactly the denomination (sent by a third party)', (await bal(ra)) === E18 && (await bal(P1.target)) === 0n, 'gas ' + wA.gasUsed);
  const evW = wA.logs.map((l) => { try { return P1.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === 'Withdrawal');
  rec('withdraw: the Withdrawal event reports recipient and nullifier', !!evW && evW.args.to === ra && evW.args.nullifierHash === BigInt(prA.nullifier), '');
  const dbl = await refuseTx(P1.connect(relayer), 'withdraw', [prA.pA, prA.pB, prA.pC, prA.root, prA.nullifier, ra], null, 'Note already spent');
  rec('withdraw: the same note cannot be spent twice ("Note already spent")', dbl.ok && (await bal(ra)) === E18, '');

  // ------------------------------------------------------------------ transfers of the native coin
  console.log('\nnative transfers: refusing and re-entering recipients, forced coin');
  const refuser = await deploy(C.Refusing);
  const nR = newNote(); await poolDeposit(P1, nR);
  const prR = await proofFor(P1, nR, refuser.target);
  const before = await poolBals(main.ps);
  const ref = await refuseTx(P1.connect(relayer), 'withdraw', [prR.pA, prR.pB, prR.pC, prR.root, prR.nullifier, refuser.target], null, 'Native transfer failed');
  rec('a recipient that refuses the coin: the withdrawal reverts ("Native transfer failed")', ref.ok && J(before) === J(await poolBals(main.ps)), ref.note);
  rec('… and the note is NOT marked spent', (await P1.nullifierHashes(prR.nullifier)) === false, '');
  const redir = await refuseTx(P1.connect(relayer), 'withdraw', [prR.pA, prR.pB, prR.pC, prR.root, prR.nullifier, rb], null, 'Invalid proof');
  rec('… its proof still cannot be redirected to another address', redir.ok, '');
  const rc2 = newAddr(); const prR2 = await proofFor(P1, nR, rc2);
  await (await P1.connect(relayer).withdraw(prR2.pA, prR2.pB, prR2.pC, prR2.root, prR2.nullifier, rc2)).wait();
  rec('… and a new proof for another address withdraws it', (await bal(rc2)) === E18, '');

  const re = await deploy(C.Reenter);
  const nE = newNote(); await poolDeposit(P1, nE);
  const prE = await proofFor(P1, nE, re.target);
  await (await re.arm(P1.target, prE.pA, prE.pB, prE.pC, prE.root, prE.nullifier)).wait();
  const poolBefore = await bal(P1.target);
  await (await P1.connect(relayer).withdraw(prE.pA, prE.pB, prE.pC, prE.root, prE.nullifier, re.target)).wait();
  rec('a recipient that re-enters withdraw() while being paid: paid exactly once', (await re.payments()) === 1n && (await bal(re.target)) === E18 && poolBefore - (await bal(P1.target)) === E18, '');
  rec('… its re-entry was refused with "Note already spent" (nullifier recorded before the transfer)', (await re.reentrySucceeded()) === false && (await re.reentryError()) === 'Note already spent', '');

  // through the router: a recipient re-enters withdrawMany with the same batch
  const setRR = await makeSet();
  const rr = await deploy(C.ReenterRouter);
  const nRR = notesFor(2); await depositVia(setRR, 11n * E18, nRR);
  const itRR = [];
  for (const [i, n] of [[2, nRR[0]], [3, nRR[1]]]) { const p = await proofFor(setRR.ps[i], n, rr.target); itRR.push({ pool: i, pA: p.pA, pB: p.pB, pC: p.pC, root: p.root, nullifierHash: p.nullifier }); }
  await (await rr.arm(setRR.d.target, itRR)).wait();
  await (await setRR.d.connect(relayer).withdrawMany(itRR, rr.target)).wait();
  rec('withdrawMany to a recipient that re-enters withdrawMany with the same batch: paid 11 once, re-entry refused',
    (await bal(rr.target)) === 11n * E18 && (await rr.reentrySucceeded()) === false && (await rr.reentryError()) === 'Note already spent' && (await rr.payments()) === 2n, 'payments ' + (await rr.payments()));

  const plainPool = await reason(async () => { const rc = await (await deployer.sendTransaction({ to: P1.target, value: 1n, gasLimit: 100000 })).wait(); if (rc.status === 0) throw new Error('status 0'); });
  const plainRouter = await reason(async () => { const rc = await (await deployer.sendTransaction({ to: main.d.target, value: 1n, gasLimit: 100000 })).wait(); if (rc.status === 0) throw new Error('status 0'); });
  rec('plain transfers of the coin to a pool and to the router are refused (no receive)', plainPool.reverted && plainRouter.reverted, '');
  // coin forced in with selfdestruct: the contracts never read their own balance, so nothing changes
  await deploy(C.Force, [main.d.target], {}, 5n);
  await deploy(C.Force, [P10.target], {}, 7n);
  const nF = notesFor(1); await depositVia(main, 10n * E18, nF);
  const rF = newAddr(); const prF = await proofFor(P10, nF[0], rF);
  await (await P10.connect(relayer).withdraw(prF.pA, prF.pB, prF.pC, prF.root, prF.nullifier, rF)).wait();
  rec('coin forced into the router and a pool (selfdestruct) changes nothing: deposit and withdraw still exact', (await bal(rF)) === 10n * E18 && (await bal(main.d.target)) === 5n, '');

  // ------------------------------------------------------------------ split
  console.log('\nsplit');
  const vectors = [[1n, [0, 0, 0, 1]], [9n, [0, 0, 0, 9]], [10n, [0, 0, 1, 0]], [60n, [0, 1, 1, 0]], [99n, [0, 1, 4, 9]], [160n, [1, 1, 1, 0]], [250n, [2, 1, 0, 0]], [3200n, [32, 0, 0, 0]]];
  let vecOk = true;
  for (const [t, exp] of vectors) {
    const [counts, total] = await main.d.split(t * E18); const js = canonicalSplit(t * E18, D18);
    if (!(counts.every((c, i) => c === BigInt(exp[i])) && js.counts.every((c, i) => c === counts[i]) && js.total === total)) vecOk = false;
  }
  rec('split: known amounts give the documented canonical notes (contract and client mirror agree)', vecOk, vectors.length + ' amounts');
  let randOk = true;
  for (let i = 0; i < 300; i++) {
    const a = BigInt(1 + Math.floor(Math.random() * 5000)) * E18;
    const [counts, total] = await main.d.split(a); const js = canonicalSplit(a, D18);
    if (!(js.counts.every((c, j) => c === counts[j]) && js.total === total && counts.reduce((s, c, j) => s + c * D18[j], 0n) === a)) { randOk = false; break; }
  }
  rec('split: 300 random amounts: contract equals mirror, notes add up to exactly the amount', randOk, '');

  // ------------------------------------------------------------------ deposit 160 = 100 + 50 + 10
  console.log('\ndeposit and composability (160 = 100 + 50 + 10)');
  const gasDep = [];
  const S = await makeSet();
  const i0 = await nextIdx(S.ps), b0 = await poolBals(S.ps), u0 = await bal(deployerAddr);
  const n160 = notesFor(3);
  const r160 = await depositVia(S, 160n * E18, n160);
  gasDep.push([3, r160.gasUsed]);
  const i1 = await nextIdx(S.ps), b1 = await poolBals(S.ps);
  rec('deposit: one note in each of the 100 / 50 / 10 pools, none in the 1 pool', i1.every((v, i) => v - i0[i] === [1, 1, 1, 0][i]), '');
  rec('deposit: each pool holds exactly its denomination more; the router holds nothing', b1.every((b, i) => b - b0[i] === [100n, 50n, 10n, 0n][i] * E18) && (await bal(S.d.target)) === 0n, '');
  rec('deposit: the depositor paid exactly the amount plus gas', u0 - (await bal(deployerAddr)) === 160n * E18 + paid(r160), '');
  const seen = []; for (const lg of r160.logs) { const i = S.ps.findIndex((p) => p.target.toLowerCase() === lg.address.toLowerCase()); if (i >= 0) { const ev = S.ps[i].interface.parseLog(lg); if (ev && ev.name === 'Deposit') seen.push(ev.args.commitment); } }
  rec('deposit: Deposit events carry the commitments in the documented order', seen.length === 3 && seen.every((c, i) => c === n160[i].commitment), '');
  const dEv = r160.logs.map((l) => { try { return S.d.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === 'Distributed');
  rec('deposit: the Distributed event reports depositor, amount and number of notes', !!dEv && dEv.args.depositor === deployerAddr && dEv.args.amount === 160n * E18 && dEv.args.notes === 3n, '');
  const tg = [newAddr(), newAddr(), newAddr()], got = [];
  for (let i = 0; i < 3; i++) { const p = await proofFor(S.ps[i], n160[i], tg[i]); await (await S.ps[i].connect(relayer).withdraw(p.pA, p.pB, p.pC, p.root, p.nullifier, tg[i])).wait(); got.push(await bal(tg[i])); }
  rec('composable: the three notes are withdrawn with the ordinary withdraw() to three empty addresses (100 / 50 / 10)', got[0] === 100n * E18 && got[1] === 50n * E18 && got[2] === 10n * E18, '');
  rec('composable: the pools are empty again', (await poolBals(S.ps)).every((b) => b === 0n), '');

  // ------------------------------------------------------------------ refusals
  console.log('\nrefusals (state must stay untouched)');
  const snap = async () => ({ idx: await nextIdx(S.ps), bal: await poolBals(S.ps), router: await bal(S.d.target) });
  const s0 = await snap();
  const dep = (amount, cs, value, text) => refuseTx(S.d, 'deposit', [amount, cs], { value }, text);
  const rv1 = await dep(11n * E18, notesFor(2).map((n) => n.commitment), 10n * E18, 'msg.value must equal amount');
  const rv2 = await dep(11n * E18, notesFor(2).map((n) => n.commitment), 12n * E18, 'msg.value must equal amount');
  rec('msg.value less or more than amount is refused ("msg.value must equal amount")', rv1.ok && rv2.ok, rv1.note);
  const rw1 = await dep(160n * E18, notesFor(2).map((n) => n.commitment), 160n * E18, 'Wrong number of commitments');
  const rw2 = await dep(160n * E18, notesFor(4).map((n) => n.commitment), 160n * E18, 'Wrong number of commitments');
  rec('too few or too many commitments are refused ("Wrong number of commitments")', rw1.ok && rw2.ok, '');
  const dn = newNote();
  rec('the same commitment twice is refused ("Duplicate commitment")', (await dep(20n * E18, [dn.commitment, dn.commitment], 20n * E18, 'Duplicate commitment')).ok, '');
  rec('zero amount is refused ("Zero amount")', (await dep(0n, [], 0n, 'Zero amount')).ok, '');
  rec('an amount off the denomination grid is refused', (await dep(E18 + 1n, [newNote().commitment], E18 + 1n, 'not a multiple')).ok, '');
  rec('33 notes are refused ("Too many notes")', (await dep(3300n * E18, notesFor(33).map((n) => n.commitment), 3300n * E18, 'Too many notes')).ok, '');
  const poorAddr = await poor.getAddress();
  const poorBal = await bal(poorAddr);
  const noBal = await reason(() => S.d.connect(poor).deposit.staticCall(poorBal + E18, notesFor(1).map((n) => n.commitment).concat([]), { value: poorBal + E18 }));
  rec('more coin than the sender holds: refused', noBal.reverted, '');
  rec('after all of those the pools and the router are exactly as before', J(s0) === J(await snap()), '');

  // ------------------------------------------------------------------ atomicity
  console.log('\natomicity');
  const rej = await deploy(C.Rejecting, [E18]);
  const mdist = await deploy(C.Dist, [[S.ps[0].target, S.ps[1].target, S.ps[2].target, rej.target]]);
  const m0 = await snap(), mu0 = await bal(deployerAddr);
  const rj = await refuseTx(mdist, 'deposit', [111n * E18, notesFor(3).map((n) => n.commitment)], { value: 111n * E18 }, 'Pool rejected the note');
  rec('a rejecting pool rolls the whole call back: the 100 and 10 notes already placed are not left behind', rj.ok && J(m0) === J(await snap()) && (await bal(mdist.target)) === 0n, rj.note);
  rec('… and the depositor got the coin back (only gas was spent)', mu0 - (await bal(deployerAddr)) < E18 / 100n, '');

  // ------------------------------------------------------------------ constructor
  console.log('\nconstructor');
  const ctor = async (addrs) => { const f = new ethers.ContractFactory(C.Dist.abi, '0x' + C.Dist.evm.bytecode.object, deployer); return reason(async () => provider.call({ data: (await f.getDeployTransaction(addrs)).data })); };
  const tok = await deploy(C.Token, [deployerAddr]);
  const erc20Pool = await deploy(C.Pool5, [tok.target, verAddr, E18], libs);
  rec('an ERC-20 V5 pool is rejected ("Not a native pool")', failsWith(await ctor([S.ps[0].target, S.ps[1].target, S.ps[2].target, erc20Pool.target]), 'Not a native pool'), '');
  rec('denominations out of order are rejected', failsWith(await ctor([S.ps[1].target, S.ps[0].target, S.ps[2].target, S.ps[3].target]), 'descending and divide'), '');
  const three = await deploy(C.Pool, [verAddr, 3n * E18], libs);
  rec('a denomination that does not divide the previous one (10 then 3) is rejected', failsWith(await ctor([S.ps[0].target, S.ps[1].target, S.ps[2].target, three.target]), 'descending and divide'), '');
  rec('a zero pool address is rejected', failsWith(await ctor([ethers.ZeroAddress, S.ps[1].target, S.ps[2].target, S.ps[3].target]), 'Zero pool'), '');

  // ------------------------------------------------------------------ withdrawMany
  console.log('\nwithdrawMany');
  const fresh = async () => { const s = await makeSet(); const ns = notesFor(3); await depositVia(s, 160n * E18, ns); return { ...s, ns }; };
  const itemFor = async (f, i, recipient) => { const p = await proofFor(f.ps[i], f.ns[i], recipient); return { pool: i, pA: p.pA, pB: p.pB, pC: p.pC, root: p.root, nullifierHash: p.nullifier }; };
  const wm = (f, items, recipient, text) => refuseTx(f.d.connect(relayer), 'withdrawMany', [items, recipient], null, text);
  const gasWm = [];
  const fa = await fresh(); const ta = newAddr();
  const itA = [await itemFor(fa, 0, ta), await itemFor(fa, 1, ta), await itemFor(fa, 2, ta)];
  const rcA = await (await fa.d.connect(relayer).withdrawMany(itA, ta)).wait();
  gasWm.push([3, rcA.gasUsed]);
  rec('three notes from three pools paid to an empty address in ONE transaction (160), sent by a third party', (await bal(ta)) === 160n * E18 && (await poolBals(fa.ps)).every((b) => b === 0n) && (await bal(fa.d.target)) === 0n, 'gas ' + rcA.gasUsed);
  const evA = rcA.logs.map((l) => { try { return fa.d.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === 'WithdrawnMany');
  rec('the WithdrawnMany event reports recipient and number of notes', !!evA && evA.args.recipient === ta && evA.args.notes === 3n, '');
  const fb = await fresh(); const tb = newAddr(), tb3 = newAddr();
  await (await fb.d.connect(relayer).withdrawMany([await itemFor(fb, 0, tb), await itemFor(fb, 2, tb)], tb)).wait();
  const restB = await proofFor(fb.ps[1], fb.ns[1], tb3);
  await (await fb.ps[1].connect(relayer).withdraw(restB.pA, restB.pB, restB.pC, restB.root, restB.nullifier, tb3)).wait();
  rec('2 of 3 notes; the third stays and is withdrawn later with the ordinary withdraw()', (await bal(tb)) === 110n * E18 && (await bal(tb3)) === 50n * E18, '');
  const fc = await fresh(); const tc = newAddr();
  const sp = await proofFor(fc.ps[1], fc.ns[1], tc);
  await (await fc.ps[1].connect(relayer).withdraw(sp.pA, sp.pB, sp.pC, sp.root, sp.nullifier, tc)).wait();
  const itC = [await itemFor(fc, 0, tc), await itemFor(fc, 1, tc), await itemFor(fc, 2, tc)];
  const c0 = J({ b: await poolBals(fc.ps), r: await bal(tc) });
  const rC = await wm(fc, itC, tc, 'Note already spent');
  rec('one already spent note reverts the whole batch, nothing is paid', rC.ok && c0 === J({ b: await poolBals(fc.ps), r: await bal(tc) }), rC.note);
  await (await fc.d.connect(relayer).withdrawMany([itC[0], itC[2]], tc)).wait();
  rec('… the other two are still spendable', (await bal(tc)) === 50n * E18 + 110n * E18, '');
  const fd = await fresh(); const td = newAddr(), td2 = newAddr();
  const itD = [await itemFor(fd, 0, td), await itemFor(fd, 1, td)];
  const d0 = J(await poolBals(fd.ps));
  rec('proofs made for one address do not pay another ("Invalid proof")', (await wm(fd, itD, td2, 'Invalid proof')).ok && (await bal(td2)) === 0n, '');
  rec('the zero address is refused ("Zero recipient")', (await wm(fd, itD, ethers.ZeroAddress, 'Zero recipient')).ok, '');
  rec('an empty list is refused ("No withdrawals")', (await wm(fd, [], td, 'No withdrawals')).ok, '');
  rec('a pool index outside 0..3 is refused ("Unknown pool")', (await wm(fd, [{ ...itD[0], pool: 4 }], td, 'Unknown pool')).ok, '');
  rec('the same note twice in one batch is refused ("Note already spent")', (await wm(fd, [itD[0], itD[0]], td, 'Note already spent')).ok, '');
  rec('more than 16 items are refused ("Too many withdrawals")', (await wm(fd, Array.from({ length: 17 }, () => itD[0]), td, 'Too many withdrawals')).ok, '');
  rec('after all of those refusals the notes are untouched', d0 === J(await poolBals(fd.ps)), '');
  const ge = await fresh();
  for (const idx of [[0], [1, 2]]) { const t = newAddr(); const its = []; for (const i of idx) its.push(await itemFor(ge, i, t)); gasWm.push([idx.length, (await (await ge.d.connect(relayer).withdrawMany(its, t)).wait()).gasUsed]); }

  // ------------------------------------------------------------------ gas and accounting
  console.log('\ngas (local EVM, recipients are empty addresses)');
  const G = await makeSet();
  for (const [t, n] of [[1n, 1], [99n, 14], [3200n, 32]]) gasDep.push([n, (await depositVia(G, t * E18, notesFor(n))).gasUsed]);
  gasDep.sort((a, b) => a[0] - b[0]); gasWm.sort((a, b) => a[0] - b[0]);
  for (const [n, g] of gasDep) console.log(`     deposit()      ${String(n).padStart(2)} note(s): ${String(g).padStart(9)} gas  (${Math.round(Number(g) / n)} per note)`);
  for (const [n, g] of gasWm) console.log(`     withdrawMany() ${String(n).padStart(2)} note(s): ${String(g).padStart(9)} gas  (${Math.round(Number(g) / n)} per note)`);
  rec('32 notes (MAX_NOTES) fit comfortably in one transaction (< 30M gas)', gasDep.find((x) => x[0] === 32)[1] < 30_000_000n, '');

  let acc = true;
  for (const s of [main, S, setRR, fa, fb, fc, fd, ge, G]) for (const p of s.ps) {
    const d = await p.DENOMINATION(), n = BigInt(await p.nextIndex());
    const w = BigInt((await p.queryFilter(p.filters.Withdrawal(), 0)).length);
    const forced = p.target === P10.target ? 7n : 0n;
    if ((await bal(p.target)) !== d * (n - w) + forced) acc = false;
  }
  rec('accounting: every pool holds exactly denomination x (deposits - withdrawals) (+ the coin forced in by the test)', acc, '');

  const ok = results.every(Boolean);
  console.log('\n' + (ok ? `ALL ${results.length} CHECKS PASSED` : `FAILED: ${results.filter((x) => !x).length} of ${results.length}`));
  return ok;
}

main().then((ok) => process.exit(ok ? 0 : 1)).catch((e) => { console.error('ERROR:', e && e.stack ? e.stack : e); process.exit(1); });
