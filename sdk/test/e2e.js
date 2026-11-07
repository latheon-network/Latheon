'use strict';
/*
 * End-to-end test of the SDK against the real contracts of this repository on a local EVM (ganache), with real
 * Groth16 proofs: V7 pools and router (withdraw_v5), plus a V6 and a V5 set for the withdraw-only paths.
 *
 *   compile  LatheonShieldedPoolV7Native, LatheonDistributionPoolV7Native, WithdrawVerifierV5 (+ V6, V5 sets, PoseidonT3)
 *   deploy   4 pools (100 / 50 / 10 / 1) + router per generation, described in a deployments.json-shaped config
 *   SDK      deposit, fetchDeposits, withdrawNote (fee 0; relayer + fee; stale-root retry; through a relayer),
 *            depositAny (master key), findNotes, withdrawByAmount (one batch; 23 notes = 16 + 7; through a relayer),
 *            planPayout / depositPayout / payOut (three recipients, resumable, through a relayer),
 *            withdrawMany limits, recipient binding, refusals of pre-V7 deposits, V6 / V5 withdrawals only
 *
 * `node test/e2e.js` (several minutes: a few dozen proofs). Exit code 0 means every check passed.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const solc = require('solc');
const ganache = require('ganache');
const { ethers } = require('ethers');
const sdk = require('../src/index');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(p, 'utf8');
const E18 = 10n ** 18n;
const D18 = [100n * E18, 50n * E18, 10n * E18, 1n * E18];
const Z = ethers.ZeroAddress;

let fails = 0, n = 0;
const ok = (name, cond, note) => { n++; if (!cond) fails++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (note ? '   [' + note + ']' : '')); };
const rejects = async (fn, re) => { try { await fn(); return false; } catch (e) { const m = [e.reason, e.shortMessage, e.message].filter(Boolean).join(' | '); return re ? re.test(m) : true; } };
const quiet = () => {};

async function main() {
  console.log('Compiling contracts from this repository...');
  const src = (f) => ({ content: read(path.join(ROOT, 'contracts', f)) });
  const out = JSON.parse(solc.compile(JSON.stringify({
    language: 'Solidity',
    sources: {
      'P7.sol': src('LatheonShieldedPoolV7Native.sol'), 'R7.sol': src('LatheonDistributionPoolV7Native.sol'), 'V7.sol': src('WithdrawVerifierV5.sol'),
      'P6.sol': src('LatheonShieldedPoolV6Native.sol'), 'R6.sol': src('LatheonDistributionPoolV6Native.sol'), 'V6.sol': src('WithdrawVerifierV4.sol'),
      'P5.sol': src('LatheonShieldedPoolV5Native.sol'), 'R5.sol': src('LatheonDistributionPoolNative.sol'), 'V5.sol': src('WithdrawVerifierV3.sol'),
      'PoseidonT3.sol': src('PoseidonT3.sol'),
    },
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.bytecode.linkReferences'] } } },
  })));
  const errors = (out.errors || []).filter((e) => e.severity === 'error');
  if (errors.length) { errors.forEach((e) => console.log(e.formattedMessage)); throw new Error('compilation failed'); }
  const K = (f, c) => out.contracts[f][c];
  const C = {
    v7: { pool: K('P7.sol', 'LatheonShieldedPoolV7Native'), router: K('R7.sol', 'LatheonDistributionPoolV7Native'), verifier: K('V7.sol', 'WithdrawVerifierV5') },
    v6: { pool: K('P6.sol', 'LatheonShieldedPoolV6Native'), router: K('R6.sol', 'LatheonDistributionPoolV6Native'), verifier: K('V6.sol', 'WithdrawVerifierV4') },
    v5: { pool: K('P5.sol', 'LatheonShieldedPoolV5Native'), router: K('R5.sol', 'LatheonDistributionPoolNative'), verifier: K('V5.sol', 'Groth16Verifier') },
    poseidon: K('PoseidonT3.sol', 'PoseidonT3'),
  };

  const gp = ganache.provider({ logging: { quiet: true }, chain: { hardfork: 'shanghai', chainId: 1337 }, wallet: { deterministic: true, totalAccounts: 6, defaultBalance: 1_000_000 }, miner: { blockGasLimit: 60000000 } });
  const provider = new ethers.BrowserProvider(gp);
  const [deployer, alice, bob, relaySigner] = await Promise.all([0, 1, 2, 3].map((i) => provider.getSigner(i)));
  const bal = (a) => provider.getBalance(a);
  const fresh = () => ethers.Wallet.createRandom().address;
  const link = (c, libs) => { let code = c.evm.bytecode.object; const refs = c.evm.bytecode.linkReferences; for (const f in refs) for (const l in refs[f]) for (const { start, length } of refs[f][l]) code = code.slice(0, start * 2) + libs[l].slice(2).toLowerCase() + code.slice(start * 2 + length * 2); return code; };
  const deploy = async (c, args = [], libs = {}) => { const f = new ethers.ContractFactory(c.abi, '0x' + link(c, libs), deployer); const x = await f.deploy(...args); await x.waitForDeployment(); return x; };

  console.log('Deploying three generations (4 pools + router each)...');
  const lib = await deploy(C.poseidon); const libs = { PoseidonT3: await lib.getAddress() };
  const sets = {};
  for (const v of ['v7', 'v6', 'v5']) {
    const verifier = await deploy(C[v].verifier);
    const pools = []; for (const d of D18) pools.push(await deploy(C[v].pool, [await verifier.getAddress(), d], libs));
    const router = await deploy(C[v].router, [await Promise.all(pools.map((p) => p.getAddress()))]);
    sets[v] = { verifier: await verifier.getAddress(), pools, poolAddrs: await Promise.all(pools.map((p) => p.getAddress())), router: await router.getAddress(), deployBlock: (await provider.getBlockNumber()) - 5 };
  }

  // a local relayer: the shape of the network's (POST /withdraw, /withdrawMany, GET /status), sending from its own account
  const relayerAddr = await relaySigner.getAddress();
  const relayLog = [];
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      const reply = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
      try {
        if (req.method === 'GET' && req.url === '/status') return reply(200, { address: relayerAddr, fee: '0' });
        const b = JSON.parse(body); relayLog.push({ url: req.url, body: b });
        if (req.url === '/withdraw') {
          const pool = REG.pools.find((p) => p.address.toLowerCase() === String(b.pool).toLowerCase()); if (!pool) return reply(400, { error: 'unknown pool' });
          const c = new ethers.Contract(pool.address, sdk.POOL_ABI[pool.version], relaySigner);
          const tx = pool.feeVersion ? await c.withdraw(b.pA, b.pB, b.pC, b.root, b.nullifierHash, b.recipient, b.relayer, b.fee) : await c.withdraw(b.pA, b.pB, b.pC, b.root, b.nullifierHash, b.recipient);
          const rc = await tx.wait(); return reply(200, { tx: rc.hash, gasUsed: rc.gasUsed.toString() });
        }
        if (req.url === '/withdrawMany') {
          const router = REG.routers.find((r) => r.address.toLowerCase() === String(b.router).toLowerCase()); if (!router) return reply(400, { error: 'unknown router' });
          const c = new ethers.Contract(router.address, sdk.ROUTER_ABI[router.version], relaySigner);
          const tx = router.feeVersion ? await c.withdrawMany(b.items, b.recipient, b.relayer) : await c.withdrawMany(b.items, b.recipient);
          const rc = await tx.wait(); return reply(200, { tx: rc.hash, gasUsed: rc.gasUsed.toString() });
        }
        reply(404, { error: 'no such route' });
      } catch (e) { reply(400, { error: (e.shortMessage || e.message || String(e)).slice(0, 200) }); }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const relayUrl = 'http://127.0.0.1:' + server.address().port;

  // ---- the registry, from a config with the shape of deployments.json
  const cfg = {
    schema: 1, generated: 'test',
    networks: { local: { name: 'Local EVM', chainId: 1337, chainIdHex: '0x539', rpcUrl: 'http://localhost', explorerUrl: '', relayer: relayUrl + '/', nativeCurrency: { name: 'LTH', symbol: 'LTH', decimals: 18 },
      v5Verifier: sets.v5.verifier, v6Verifier: sets.v6.verifier, v7Verifier: sets.v7.verifier, tokens: { LTH: { address: Z, decimals: 18, native: true } } } },
    pools: [], routers: [],
  };
  for (const v of ['v7', 'v6', 'v5']) {
    [100, 50, 10, 1].forEach((amount, i) => cfg.pools.push(Object.assign({ id: `local:LTH-${amount}:${v}`, network: 'local', version: v + '-native', token: 'LTH', amount, address: sets[v].poolAddrs[i], deployBlock: sets[v].deployBlock }, v === 'v7' ? {} : { frozen: true, forgeable: true })));
    cfg.routers.push(Object.assign({ id: `local:LTH:${v}`, network: 'local', token: 'LTH', native: true, version: v, address: sets[v].router, deployBlock: sets[v].deployBlock }, v === 'v7' ? {} : { frozen: true }));
  }
  const REG = sdk.loadDeployments(cfg);
  const P = (v, amount) => sdk.poolById(REG, `local:LTH-${amount}:${v}`);
  const R = (v) => sdk.routerById(REG, `local:LTH:${v}`);
  ok('registry from a deployments.json-shaped config: 12 pools, 3 routers, only V7 depositable, verifiers per generation',
    REG.pools.length === 12 && REG.routers.length === 3 && sdk.listPools(REG, { depositable: true }).length === 4 && sdk.listRouters(REG, { depositable: true }).length === 1 && P('v7', 1).verifierAddr === sets.v7.verifier && P('v5', 1).verifierAddr === sets.v5.verifier && P('v5', 1).levels === 8 && P('v6', 1).levels === 20);
  ok('registry: checks of the router against the chain pass for all three (token, pools, denominations, split)', await sdk.checkRouterOnChain(provider, R('v7'), 161n * E18) && await sdk.checkRouterOnChain(provider, R('v6')) && await sdk.checkRouterOnChain(provider, R('v5')));
  ok('registry: a router entry whose pool differs from the chain is refused by checkRouterOnChain and depositAny', await rejects(async () => sdk.checkRouterOnChain(provider, Object.assign({}, R('v7'), { denominations: D18.slice(0, 3).concat([2n * E18]) })), /denomination 3 on chain differs/) && await rejects(async () => sdk.depositAny(alice, Object.assign({}, R('v7'), { pools: [R('v6').pools[0]].concat(R('v7').pools.slice(1)) }), 161n * E18), /pool 0 on chain differs/));

  // preload circuits once (the SDK would load them per call otherwise)
  const circ = { v7: await sdk.loadCircuit('v7'), v6: await sdk.loadCircuit('v6'), v5: await sdk.loadCircuit('v5') };
  const opts = (v, extra) => Object.assign({ circuit: circ[v], log: quiet }, extra || {});

  // ------------------------------------------------------------------ one V7 pool
  console.log('\nV7 pool: deposit, scan, withdraw');
  const pool100 = P('v7', 100);
  const dep = await sdk.deposit(alice, pool100);
  ok('deposit(): 100 LTH into the V7 100 pool, leaf 0, note text names chain 1337 and the pool', (await bal(pool100.address)) === 100n * E18 && dep.leafIndex === 0 && sdk.decodeNote(dep.note).address === pool100.address && sdk.decodeNote(dep.note).chainId === 1337 && dep.commitment === sdk.computeCommitment(dep.spendKey, dep.viewKey));
  const deps = await sdk.fetchDeposits(provider, pool100);
  ok('fetchDeposits(): one deposit, the commitment, checked against nextIndex()', deps.length === 1 && deps[0].commitment === dep.commitment && deps[0].leafIndex === 0 && deps[0].timestamp > 0);
  const pi = await sdk.getProofInputsForCommitment(provider, pool100, dep.commitment);
  ok('getProofInputsForCommitment(): 20-level path whose root the pool knows', pi.pathElements.length === 20 && pi.leafIndex === 0 && (await sdk.isKnownRoot(provider, pool100, pi.root)) && sdk.rootFromPath(dep.commitment, pi.pathElements, pi.pathIndices) === pi.root);
  const head = await provider.getBlockNumber();
  ok('fetchDeposits() refuses an incomplete scan (a range that misses the deposit); an old toBlock gives the tree as it was', await rejects(async () => sdk.fetchDeposits(provider, Object.assign({}, pool100, { startBlock: head + 1 })), /incomplete/) && (await sdk.fetchDeposits(provider, pool100, { toBlock: head - 1 })).length === 0);
  ok('a commitment that is not on chain is reported as such', await rejects(async () => sdk.getProofInputsForCommitment(provider, pool100, 12345n), /not found/));
  ok('isSpent(): false before the withdrawal (by note, by spendKey, by nullifier)', !(await sdk.isSpent(provider, pool100, dep)) && !(await sdk.isSpent(provider, pool100, dep.spendKey)) && !(await sdk.isSpent(provider, pool100, { nullifierHash: dep.nullifierHash })));

  const to1 = fresh();
  const w1 = await sdk.withdrawNote(bob, pool100, dep.note, to1, opts('v7'));
  ok('withdrawNote(): sent by another wallet, the empty recipient receives exactly 100 LTH; proof has 5 signals', (await bal(to1)) === 100n * E18 && w1.proof.pubSignals.length === 5 && !w1.relayed && w1.leafIndex === 0 && (await bal(pool100.address)) === 0n, 'tx ' + w1.txHash.slice(0, 10));
  ok('isSpent(): true after; a second withdrawal is refused before proving', (await sdk.isSpent(provider, pool100, dep)) && await rejects(async () => sdk.withdrawNote(bob, pool100, dep.note, to1, opts('v7')), /already spent/));

  // relayer + fee
  console.log('\nV7 pool: relayer fee bound into the proof');
  const pool10 = P('v7', 10);
  const dep10 = await sdk.deposit(alice, pool10);
  const to2 = fresh(), feeTaker = fresh();
  const relayBefore = await bal(feeTaker);
  const w2 = await sdk.withdrawNote(bob, pool10, dep10.note, to2, opts('v7', { relayer: feeTaker, fee: 2n * E18 }));
  ok('withdrawNote() with relayer and fee: recipient gets 8, the relayer named in the proof gets 2 (sender is a third party)', (await bal(to2)) === 8n * E18 && (await bal(feeTaker)) - relayBefore === 2n * E18 && BigInt(w2.proof.pubSignals[3]) === BigInt(feeTaker) && BigInt(w2.proof.pubSignals[4]) === 2n * E18);
  const ev = w2.receipt.logs.map((l) => { try { return new ethers.Interface(sdk.POOL_ABI.v7).parseLog(l); } catch (e) { return null; } }).find((e) => e && e.name === 'Withdrawal');
  ok('… the Withdrawal event reports recipient, relayer and fee', !!ev && ev.args.to === to2 && ev.args.relayer === feeTaker && ev.args.fee === 2n * E18);
  ok('buildWithdrawInput refuses a fee without a relayer, and the contract refuses fee > denomination', await rejects(async () => sdk.withdrawNote(bob, pool10, (await sdk.deposit(alice, pool10)).note, to2, opts('v7', { fee: 1n })), /relayer/));

  // recipient binding at the contract
  const dep1 = await sdk.deposit(alice, P('v7', 1));
  const bound = await sdk.getProofInputsForCommitment(provider, P('v7', 1), dep1.commitment);
  const proofA = await sdk.proveWithdraw(sdk.buildWithdrawInput({ version: 'v7', spendKey: dep1.spendKey, viewKey: dep1.viewKey, pathElements: bound.pathElements, pathIndices: bound.pathIndices, root: bound.root, recipient: to1 }), circ.v7);
  ok('verifyOnChain(): the verifier contract accepts the proof', await sdk.verifyOnChain(provider, P('v7', 1), proofA));
  ok('withdraw(): the simulation surfaces the pool\'s refusal for another recipient ("Invalid proof") and for a fee without a relayer', await rejects(async () => sdk.withdraw(bob, P('v7', 1), proofA, to2), /Invalid proof/) && await rejects(async () => sdk.withdraw(bob, P('v7', 1), proofA, to1, { fee: 1n }), /Fee without relayer/));
  const wA = await sdk.withdraw(bob, P('v7', 1), proofA, to1);
  ok('withdraw(): the same proof pays its own recipient', !!wA.txHash && (await bal(to1)) === 101n * E18);

  // stale root: the pool forgets a root after 100 newer deposits; withdrawNote proves again
  console.log('\nV7 pool: stale root retry (100 deposits after the scan)');
  const pool1 = P('v7', 1);
  const depS = await sdk.deposit(alice, pool1);
  const depS2 = await sdk.deposit(alice, pool1);   // a second note from before the 100 deposits, for the give-up check
  const blockBefore = await provider.getBlockNumber();
  const p1c = new ethers.Contract(pool1.address, sdk.POOL_ABI.v7, deployer);
  for (let i = 0; i < 100; i++) await (await p1c.deposit(sdk.randomFieldElement(), { value: E18 })).wait();
  const stale = { pool: pool1.address, startBlock: pool1.startBlock }; void stale;
  const scanOpts = { toBlock: blockBefore };   // first attempt scans an old block: its root is forgotten
  const logs = [];
  const toS = fresh();
  const wS = await sdk.withdrawNote(bob, pool1, depS.note, toS, opts('v7', { scanOpts, log: (m) => { logs.push(m); if (/proving again/.test(m)) delete scanOpts.toBlock; } }));
  ok('withdrawNote(): "Unknown root" after the scan is retried with a fresh scan and succeeds', (await bal(toS)) === E18 && logs.some((m) => /proving again/.test(m)) && wS.leafIndex === 1);
  const logs2 = [];
  ok('… without a fresh scan it gives up after ROOT_RETRIES attempts ("Unknown root")', await rejects(async () => sdk.withdrawNote(bob, pool1, depS2.note, toS, opts('v7', { scanOpts: { toBlock: blockBefore }, log: (m) => logs2.push(m) })), /Unknown root/) && logs2.filter((m) => /proving again/.test(m)).length === sdk.ROOT_RETRIES - 1 && sdk.ROOT_RETRIES === 3);

  // through a relayer (a Provider is enough)
  console.log('\nV7 pool: through the relayer');
  const depR = await sdk.deposit(alice, P('v7', 10));
  const toR = fresh();
  const wR = await sdk.withdrawNote(provider, P('v7', 10), depR.note, toR, opts('v7', { viaRelayer: true }));
  ok('withdrawNote(viaRelayer): the relayer sends it; recipient gets 10; body carries pool, proof, root, nullifier, recipient, relayer 0, fee 0', wR.relayed && (await bal(toR)) === 10n * E18 && relayLog.length === 1 && relayLog[0].url === '/withdraw' && relayLog[0].body.pool === P('v7', 10).address && relayLog[0].body.recipient === toR && relayLog[0].body.relayer === Z && relayLog[0].body.fee === '0' && typeof relayLog[0].body.pA[0] === 'string');
  ok('relayStatus() reads the relayer; hasRelayer() follows deployments.json', (await sdk.relayStatus(P('v7', 10).net)).address === relayerAddr && sdk.hasRelayer(P('v7', 10).net) && !sdk.hasRelayer({}));

  // ------------------------------------------------------------------ V7 router
  console.log('\nV7 router: any amount under one master key, withdraw by amount');
  const r7 = R('v7');
  const balsBefore = await Promise.all(r7.pools.map((p) => bal(p.address)));
  const da = await sdk.depositAny(alice, r7, sdk.toUnits(r7, '161'));
  const balsAfter = await Promise.all(r7.pools.map((p) => bal(p.address)));
  ok('depositAny(161): one note in each pool (100 + 50 + 10 + 1), router holds nothing, master key text', da.notes.length === 4 && da.plan.counts.join() === '1,1,1,1' && balsAfter.every((b, i) => b - balsBefore[i] === D18[i]) && (await bal(r7.address)) === 0n && sdk.parseMasterKey(da.masterKey).router === r7.address && sdk.parseMasterKey(da.masterKey).chainId === 1337 && da.notes.every((x, i) => x.pool === r7.pools[i] && sdk.isNote(x.note)));
  const found = await sdk.findNotes(provider, r7, da.masterKey);
  ok('findNotes(): the four notes, with pool, leaf index and spent = false; total 161', found.notes.length === 4 && found.unspent.length === 4 && found.total === 161n * E18 && found.notes.map((x) => x.value).join() === '100,50,10,1' && found.notes.every((x) => x.poolIndex === r7.pools.indexOf(x.pool) && Number.isInteger(x.leafIndex) && x.spent === false));
  ok('selectNotesForAmount(): 111 -> 100 + 10 + 1; 70 is unreachable (nearest 61)', sdk.selectNotesForAmount(found.notes, 111).chosen.map((x) => x.value).join() === '100,10,1' && sdk.selectNotesForAmount(found.notes, 70).chosen === null && sdk.selectNotesForAmount(found.notes, 70).nearest === 61);
  const to3 = fresh();
  const wb = await sdk.withdrawByAmount(bob, r7, da.masterKey, 111, to3, opts('v7', { notes: found }));
  ok('withdrawByAmount(111): one withdrawMany, three notes, recipient gets exactly 111', wb.txHashes.length === 1 && wb.batches === 1 && wb.notes.length === 3 && (await bal(to3)) === 111n * E18);
  const found2 = await sdk.findNotes(provider, r7, da.masterKey);
  ok('findNotes() after: three spent, one unspent (50)', found2.notes.filter((x) => x.spent).length === 3 && found2.unspent.length === 1 && found2.unspent[0].value === 50 && found2.total === 50n * E18);
  ok('withdrawByAmount(): an amount no notes add up to is refused with the nearest sum', await rejects(async () => sdk.withdrawByAmount(bob, r7, da.masterKey, 70, to3, opts('v7')), /nearest reachable sum is 50/));
  ok('withdrawByAmount(): a master key of another router is refused', await rejects(async () => sdk.withdrawByAmount(bob, r7, sdk.formatMasterKey(1337, R('v6').address, 5n), 1, to3, opts('v7')), /belongs to router/));

  console.log('\nV7 router: 23 notes = two withdrawMany batches (16 + 7), through the relayer with a fee');
  const big = await sdk.depositAny(alice, r7, 999n * E18);
  ok('depositAny(999): 23 notes (9 x 100, 50, 4 x 10, 9 x 1)', big.notes.length === 23 && big.plan.counts.join() === '9,1,4,9');
  const to4 = fresh(), feeTaker2 = fresh();
  const relayCount = relayLog.length;
  const wBig = await sdk.withdrawByAmount(provider, r7, big.masterKey, 999, to4, opts('v7', { viaRelayer: true, relayer: feeTaker2, fee: E18 / 10n }));
  ok('withdrawByAmount(999, viaRelayer, fee 0.1 per note): two relayed batches of 16 and 7; recipient gets 999 - 2.3, relayer 2.3', wBig.relayed && wBig.batches === 2 && wBig.txHashes.length === 2 && (await bal(to4)) === 999n * E18 - 23n * E18 / 10n && (await bal(feeTaker2)) === 23n * E18 / 10n && relayLog.length === relayCount + 2 && relayLog[relayCount].body.items.length === 16 && relayLog[relayCount + 1].body.items.length === 7 && relayLog[relayCount].body.relayer === feeTaker2 && relayLog[relayCount].body.items[0].length === 7);
  ok('… every note of the master key is now spent', (await sdk.findNotes(provider, r7, big.masterKey)).unspent.length === 0);
  ok('withdrawMany(): 17 items are refused by the SDK before the chain; an empty batch too', await rejects(async () => sdk.withdrawMany(bob, r7, Array(17).fill(null), to4), /At most 16/) && await rejects(async () => sdk.withdrawMany(bob, r7, [], to4), /No withdrawals/));

  // withdrawMany with items built by hand (two notes, one batch, from a signer)
  const two = await sdk.depositAny(alice, r7, 60n * E18);
  const items = [];
  for (const x of (await sdk.findNotes(provider, r7, two.masterKey)).unspent) {
    const inp = await sdk.getProofInputsForCommitment(provider, x.pool, x.commitment);
    const pr = await sdk.proveWithdraw(sdk.buildWithdrawInput({ version: 'v7', spendKey: x.spendKey, viewKey: x.viewKey, pathElements: inp.pathElements, pathIndices: inp.pathIndices, root: inp.root, recipient: to3 }), circ.v7);
    items.push(sdk.buildWithdrawManyItem(r7, x.poolIndex, pr));
  }
  const wm = await sdk.withdrawMany(bob, r7, items, to3);
  ok('withdrawMany() with hand-built items (50 + 10): one transaction, recipient +60', !!wm.txHash && items.length === 2 && (await bal(to3)) === 171n * E18);
  ok('withdrawMany(): the same items again are refused by the simulation ("Note already spent")', await rejects(async () => sdk.withdrawMany(bob, r7, items, to3), /already spent/));

  // ------------------------------------------------------------------ payouts to a list of recipients
  console.log('\nV7 router: payout to three recipients (111, 61, 1234), deposits packed greedy-exact, one record');
  const payees = [111, 61, 1234].map((a) => ({ recipient: fresh(), amount: sdk.toUnits(r7, String(a)) }));
  const plan = sdk.planPayout(r7, payees);
  const rec = sdk.payoutFromJson(sdk.payoutToJson(await sdk.depositPayout(alice, r7, plan)));
  ok('depositPayout(): one router deposit per chunk, one master key each, router holds nothing; record names router and chain', rec.masterKeys.length === plan.chunks.length && rec.depositTxs.length === plan.chunks.length && plan.chunks.length >= 2 && rec.chainId === 1337 && rec.router === r7.address && (await bal(r7.address)) === 0n && rec.minBlock > 0);
  const first = await sdk.payOut(bob, r7, rec, opts('v7', { only: [0] }));
  ok('payOut(only payee 1, from a signer): 111 arrives; the others are skipped', first[0].status === 'paid' && first[1].status === 'skipped' && first[2].status === 'skipped' && (await bal(payees[0].recipient)) === 111n * E18 && (await bal(payees[1].recipient)) === 0n);
  const payRelayBefore = relayLog.length;
  const rest = await sdk.payOut(provider, r7, rec, opts('v7', { viaRelayer: true }));
  ok('payOut(again, through the relayer): payee 1 already paid; 61 in one batch, 1234 (19 notes) in two; exact amounts', rest[0].status === 'already paid' && rest[1].status === 'paid' && rest[1].txHashes.length === 1 && rest[2].status === 'paid' && rest[2].txHashes.length === 2 && (await bal(payees[1].recipient)) === 61n * E18 && (await bal(payees[2].recipient)) === 1234n * E18 && relayLog.length === payRelayBefore + 3);
  const again = await sdk.payOut(provider, r7, rec, opts('v7', { viaRelayer: true }));
  ok('payOut() a third time: everyone already paid, nothing sent', again.every((x) => x.status === 'already paid') && relayLog.length === payRelayBefore + 3);
  ok('payOut(): a record of another router is refused', await rejects(async () => sdk.payOut(bob, R('v6'), rec, opts('v6')), /belongs to router/));

  // ------------------------------------------------------------------ pre-V7: withdrawals only
  console.log('\nV6 and V5: deposits refused, withdrawals of existing notes work');
  ok('deposit() into a V6 pool and depositAny() through a V5 router are refused before any transaction', await rejects(async () => sdk.deposit(alice, P('v6', 100)), /pre-V7/) && await rejects(async () => sdk.depositAny(alice, R('v5'), 10n * E18), /pre-V7/) && await rejects(async () => sdk.depositAny(alice, R('v6'), 10n * E18), /pre-V7/));
  for (const v of ['v6', 'v5']) {
    const pool = P(v, 10);
    const note = sdk.generateNote(pool);   // an "existing" note: deposited with the contract directly, as a pre-V7 user did
    await (await new ethers.Contract(pool.address, sdk.POOL_ABI[v], alice).deposit(note.commitment, { value: 10n * E18 })).wait();
    const to = fresh();
    const w = await sdk.withdrawNote(bob, pool, note.note, to, opts(v, v === 'v6' ? { relayer: feeTaker, fee: E18 } : {}));
    ok(`${v} pool: withdrawNote() with circuit ${pool.circuit} (${pool.levels} levels, ${w.proof.pubSignals.length} signals)${v === 'v6' ? ', fee 1 to the relayer' : ''}`, (await bal(to)) === (v === 'v6' ? 9n : 10n) * E18 && w.proof.pubSignals.length === (v === 'v6' ? 5 : 3) && w.proof.version === v);
    const router = R(v);
    const master = sdk.randomFieldElement();
    const derived = sdk.deriveNotes(master, 1337, 3);
    await (await new ethers.Contract(router.address, sdk.ROUTER_ABI[v], alice).deposit(61n * E18, derived.map((x) => x.commitment), { value: 61n * E18 })).wait();
    const mk = sdk.formatMasterKey(1337, router.address, master);
    const f = await sdk.findNotes(provider, router, mk);
    const toM = fresh();
    const wm2 = await sdk.withdrawByAmount(bob, router, mk, 61, toM, opts(v));
    ok(`${v} router: findNotes() (50 + 10 + 1) and withdrawByAmount(61) with withdrawMany${v === 'v5' ? '(items, recipient)' : '(items with fee, recipient, relayer)'}`, f.unspent.length === 3 && wm2.txHashes.length === 1 && (await bal(toM)) === 61n * E18);
  }
  const n5 = sdk.generateNote(P('v5', 1));
  await (await new ethers.Contract(P('v5', 1).address, sdk.POOL_ABI.v5, alice).deposit(n5.commitment, { value: E18 })).wait();
  ok('V5 withdrawal input refuses a relayer fee (no such public input)', await rejects(async () => sdk.withdrawNote(bob, P('v5', 1), n5.note, fresh(), opts('v5', { fee: 1n, relayer: feeTaker })), /V5 proofs have no relayer/));

  server.close();
  console.log(fails ? '\n' + fails + ' of ' + n + ' FAILED' : '\nALL ' + n + ' CHECKS PASSED');
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error('ERROR', e); process.exit(1); });
