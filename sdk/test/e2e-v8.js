'use strict';
/*
 * End-to-end test of the SDK's V8 paths against the V8 contracts of this repository on a local EVM (ganache), with
 * real Groth16 proofs and the committed development keys (circuits/build/withdraw_v6, disclose_v2, disclose_link):
 *
 *   one pool:   deposit, withdrawNote from a wallet (no fee; relayer fee and payment reference), through a relayer
 *   router:     depositAny, findNotes, withdrawByAmount (one note already withdrawn elsewhere: the router skips it)
 *   one master key across generations: the same master deposited through the V7 and the V8 router, findNotesAll sees both
 *   disclosure: disclose_v2 and disclose_link proofs accepted by the deployed verifiers
 *   refusals:   wrong destination chain, recipient other than the proof's, V8 report files (not supported yet)
 *
 * `node test/e2e-v8.js` (a few minutes). Exit code 0 means every check passed.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const solc = require('solc-0839');
const ganache = require('ganache');
const { ethers } = require('ethers');
const sdk = require('../src/index');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(p, 'utf8');
const E18 = 10n ** 18n;
const D18 = [100n * E18, 50n * E18, 10n * E18, 1n * E18];
const Z = ethers.ZeroAddress;
const CHAIN = 60531373273;

let fails = 0, n = 0;
const ok = (name, cond, note) => { n++; if (!cond) fails++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (note ? '   [' + note + ']' : '')); };
const rejects = async (fn, re) => { try { await fn(); return false; } catch (e) { const m = [e.reason, e.shortMessage, e.message].filter(Boolean).join(' | '); return re ? re.test(m) : true; } };

async function main() {
  console.log('Compiling V8 and V7 contracts with solc ' + solc.version() + '...');
  const src = (f) => ({ content: read(path.join(ROOT, 'contracts', f)) });
  const out = JSON.parse(solc.compile(JSON.stringify({
    language: 'Solidity',
    sources: {
      'contracts/ILatheonV8.sol': src('ILatheonV8.sol'), 'P8.sol': src('LatheonShieldedPoolV8Native.sol'), 'R8.sol': src('LatheonDistributionPoolV8Native.sol'),
      'V8.sol': src('WithdrawVerifierV6.sol'), 'D8.sol': src('DiscloseVerifierV2.sol'), 'L8.sol': src('DiscloseLinkVerifier.sol'),
      'P7.sol': src('LatheonShieldedPoolV7Native.sol'), 'R7.sol': src('LatheonDistributionPoolV7Native.sol'), 'V7.sol': src('WithdrawVerifierV5.sol'),
      'ILatheonV8.sol': src('ILatheonV8.sol'), 'PoseidonT3.sol': src('PoseidonT3.sol'),
    },
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.bytecode.linkReferences'] } } },
  }), { import: (p) => { const f = path.join(ROOT, 'contracts', path.basename(p)); return fs.existsSync(f) ? { contents: read(f) } : { error: 'not found ' + p }; } }));
  const errors = (out.errors || []).filter((e) => e.severity === 'error');
  if (errors.length) { errors.forEach((e) => console.log(e.formattedMessage)); throw new Error('compilation failed'); }
  const K = (f, c) => out.contracts[f][c];
  const C = {
    v8: { pool: K('P8.sol', 'LatheonShieldedPoolV8Native'), router: K('R8.sol', 'LatheonDistributionPoolV8Native'), verifier: K('V8.sol', 'WithdrawVerifierV6'), disclose: K('D8.sol', 'DiscloseVerifierV2'), link: K('L8.sol', 'DiscloseLinkVerifier') },
    v7: { pool: K('P7.sol', 'LatheonShieldedPoolV7Native'), router: K('R7.sol', 'LatheonDistributionPoolV7Native'), verifier: K('V7.sol', 'WithdrawVerifierV5') },
    poseidon: K('PoseidonT3.sol', 'PoseidonT3'),
  };

  const gp = ganache.provider({ logging: { quiet: true }, chain: { hardfork: 'shanghai', chainId: CHAIN }, wallet: { deterministic: true, totalAccounts: 6, defaultBalance: 100000 }, miner: { blockGasLimit: 60000000 } });
  const provider = new ethers.BrowserProvider(gp);
  const [deployer, alice, bob, relaySigner] = await Promise.all([0, 1, 2, 3].map((i) => provider.getSigner(i)));
  const bal = (a) => provider.getBalance(a);
  const fresh = () => ethers.Wallet.createRandom().address;
  const link = (c, libs) => { let code = c.evm.bytecode.object; const refs = c.evm.bytecode.linkReferences; for (const f in refs) for (const l in refs[f]) for (const { start, length } of refs[f][l]) code = code.slice(0, start * 2) + libs[l].slice(2).toLowerCase() + code.slice(start * 2 + length * 2); return code; };
  const deploy = async (c, args = [], libs = {}) => { const f = new ethers.ContractFactory(c.abi, '0x' + link(c, libs), deployer); const x = await f.deploy(...args); await x.waitForDeployment(); return x; };

  console.log('Deploying V8 and V7 (4 pools + router each)...');
  const lib = await deploy(C.poseidon); const libs = { PoseidonT3: await lib.getAddress() };
  const sets = {};
  for (const v of ['v8', 'v7']) {
    const verifier = await deploy(C[v].verifier);
    const pools = []; for (const d of D18) pools.push(await deploy(C[v].pool, v === 'v8' ? [await verifier.getAddress(), d, Z] : [await verifier.getAddress(), d], libs));
    const router = await deploy(C[v].router, [await Promise.all(pools.map((p) => p.getAddress()))]);
    sets[v] = { verifier: await verifier.getAddress(), pools, poolAddrs: await Promise.all(pools.map((p) => p.getAddress())), router: await router.getAddress(), deployBlock: (await provider.getBlockNumber()) - 5 };
  }
  const discloseV2 = await deploy(C.v8.disclose), discloseLink = await deploy(C.v8.link);

  // a local relayer with the V8 request shape: POST /withdraw { pool, pA, pB, pC, root, nullifierHash, recipient, relayer, fee, paymentRef, destChainId }
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
          const tx = pool.version === 'v8' ? await c.withdraw([b.pA, b.pB, b.pC], b.root, b.nullifierHash, [b.recipient, b.relayer, b.fee, b.paymentRef, b.destChainId])
            : await c.withdraw(b.pA, b.pB, b.pC, b.root, b.nullifierHash, b.recipient, b.relayer, b.fee);
          const rc = await tx.wait(); return reply(200, { tx: rc.hash, gasUsed: rc.gasUsed.toString() });
        }
        if (req.url === '/withdrawMany') {
          const router = REG.routers.find((r) => r.address.toLowerCase() === String(b.router).toLowerCase()); if (!router) return reply(400, { error: 'unknown router' });
          const c = new ethers.Contract(router.address, sdk.ROUTER_ABI[router.version], relaySigner);
          const rc = await (await c.withdrawMany(b.items, b.recipient, b.relayer)).wait(); return reply(200, { tx: rc.hash, gasUsed: rc.gasUsed.toString() });
        }
        reply(404, { error: 'no such route' });
      } catch (e) { reply(400, { error: (e.shortMessage || e.message || String(e)).slice(0, 200) }); }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const relayUrl = 'http://127.0.0.1:' + server.address().port;

  // ---- registry: a deployments.json-shaped config with V7, merged with a deployments-v8.json-shaped entry (as on the test chain)
  const cfg = {
    schema: 1, generated: 'test',
    networks: { local: { name: 'Local EVM', chainId: CHAIN, rpcUrl: 'http://localhost', explorerUrl: '', relayer: relayUrl + '/', v7Verifier: sets.v7.verifier, tokens: { LTH: { address: Z, decimals: 18, native: true } } } },
    pools: [100, 50, 10, 1].map((amount, i) => ({ id: `local:LTH-${amount}:v7`, network: 'local', version: 'v7-native', token: 'LTH', amount, address: sets.v7.poolAddrs[i], deployBlock: sets.v7.deployBlock })),
    routers: [{ id: 'local:LTH:v7', network: 'local', token: 'LTH', native: true, version: 'v7', address: sets.v7.router, deployBlock: sets.v7.deployBlock }],
  };
  const v8entry = {
    network: { id: 'local', chainId: CHAIN }, version: 'v8-native',
    verifiers: { withdraw: sets.v8.verifier, disclose: await discloseV2.getAddress(), discloseLink: await discloseLink.getAddress() },
    pools: [100, 50, 10, 1].map((amount, i) => ({ id: `local:LTH-${amount}:v8`, network: 'local', version: 'v8-native', token: 'LTH', amount, address: sets.v8.poolAddrs[i], deployBlock: sets.v8.deployBlock })),
    routers: [{ id: 'local:LTH:v8', network: 'local', token: 'LTH', native: true, version: 'v8', address: sets.v8.router, deployBlock: sets.v8.deployBlock }],
  };
  const REG = sdk.loadDeployments(sdk.mergeV8(cfg, v8entry));
  const P = (v, amount) => sdk.poolById(REG, `local:LTH-${amount}:${v}`);
  const R = (v) => sdk.routerById(REG, `local:LTH:${v}`);
  ok('registry: V8 merged in front of V7, both depositable, V8 verifiers set', REG.routers[0].version === 'v8' && sdk.listRouters(REG, { depositable: true }).length === 2 && P('v8', 1).verifierAddr === sets.v8.verifier && P('v8', 1).discloseVerifierAddr === v8entry.verifiers.disclose);
  ok('checkRouterOnChain passes for the V8 router (token, pools, denominations, split)', await sdk.checkRouterOnChain(provider, R('v8'), 161n * E18));
  ok('contextOf(pool) equals the pool\'s ctx() on chain, for all four V8 pools', (await Promise.all([100, 50, 10, 1].map(async (a) => (await new ethers.Contract(P('v8', a).address, sdk.POOL_ABI.v8, provider).ctx()) === sdk.contextOf(P('v8', a))))).every(Boolean));

  const c8 = await sdk.loadCircuit('v8');
  console.log('\none pool');
  const d1 = await sdk.deposit(alice, P('v8', 10));
  ok('deposit into the 10-LTH V8 pool: V8 commitment on chain', d1.leafIndex === 0 && d1.commitment === sdk.computeCommitmentV8(d1.spendKey, d1.viewKey) && (await bal(P('v8', 10).address)) === 10n * E18);
  const to1 = fresh();
  const w1 = await sdk.withdrawNote(bob, P('v8', 10), d1.note, to1, { circuit: c8, minBlock: d1.receipt.blockNumber });
  ok('withdrawNote from a wallet to an empty address: exactly 10 LTH; a random payment reference was bound and is in the Withdrawal event', (await bal(to1)) === 10n * E18 && /^0x[0-9a-f]{64}$/.test(w1.proof.ext.paymentRef)
    && w1.receipt.logs.some((l) => { try { const e = new ethers.Interface(sdk.POOL_ABI.v8).parseLog(l); return e.name === 'Withdrawal' && e.args.paymentRef === w1.proof.ext.paymentRef; } catch (x) { return false; } }));
  ok('isSpent (from the pool\'s withdrawals) knows the note is spent', await sdk.isSpent(provider, P('v8', 10), d1));
  ok('the same note again is refused before proving ("already spent")', await rejects(() => sdk.withdrawNote(bob, P('v8', 10), d1.note, fresh(), { circuit: c8 }), /already spent/));

  const d2 = await sdk.deposit(alice, P('v8', 10));
  const to2 = fresh(), rel2 = fresh(), ref2 = ethers.keccak256(ethers.toUtf8Bytes('invoice 42|' + Date.now()));
  const w2 = await sdk.withdrawNote(bob, P('v8', 10), d2.note, to2, { circuit: c8, relayer: rel2, fee: E18, paymentRef: ref2, minBlock: d2.receipt.blockNumber });
  ok('withdrawNote with a relayer fee and an invoice reference: 9 LTH to the recipient, 1 to the relayer, the reference bound', (await bal(to2)) === 9n * E18 && (await bal(rel2)) === E18 && w2.proof.ext.paymentRef === ref2.toLowerCase());

  const d3 = await sdk.deposit(alice, P('v8', 1));
  const to3 = fresh();
  const w3 = await sdk.withdrawNote(provider, P('v8', 1), d3.note, to3, { circuit: c8, viaRelayer: true, minBlock: d3.receipt.blockNumber });
  const lastRelay = relayLog[relayLog.length - 1].body;
  ok('withdrawNote through the relayer (no wallet): the empty address gets 1 LTH; the request carried paymentRef and destChainId', w3.relayed && (await bal(to3)) === E18 && lastRelay.paymentRef === w3.proof.ext.paymentRef && String(lastRelay.destChainId) === String(CHAIN));

  const d4 = await sdk.deposit(alice, P('v8', 1));
  const tree4 = await sdk.getProofInputsForCommitment(provider, P('v8', 1), d4.commitment);
  const in4 = sdk.buildWithdrawInput({ version: 'v8', spendKey: d4.spendKey, viewKey: d4.viewKey, pathElements: tree4.pathElements, pathIndices: tree4.pathIndices, root: tree4.root, ctx: sdk.contextOf(P('v8', 1)), recipient: fresh(), destChainId: 421614 });
  const p4 = await sdk.proveWithdraw(in4, c8);
  ok('a proof made for another destination chain is refused by the pool ("Wrong destination chain")', await rejects(() => sdk.withdraw(bob, P('v8', 1), p4, p4.ext.recipient), /Wrong destination chain/));
  ok('withdraw() refuses to send a V8 proof to a recipient other than the proof\'s, before any call', await rejects(() => sdk.withdraw(bob, P('v8', 1), p4, fresh()), /made for recipient/));

  console.log('\nrouter');
  const master = sdk.randomFieldElement();
  const dep = await sdk.depositAny(alice, R('v8'), 161n * E18, { master });
  ok('depositAny 161 LTH through the V8 router: 4 notes, master key names the V8 router, router holds nothing', dep.notes.length === 4 && dep.masterKey.includes(R('v8').address) && (await bal(R('v8').address)) === 0n && dep.notes.every((x) => x.commitment === sdk.computeCommitmentV8(x.spendKey, x.viewKey) && x.nullifierHash === sdk.nullifierFor(x.pool, x.spendKey)));
  const found = await sdk.findNotes(provider, R('v8'), dep.masterKey, { minBlock: dep.receipt.blockNumber });
  ok('findNotes finds the 4 V8 notes, unspent, total 161', found.notes.length === 4 && found.unspent.length === 4 && found.total === 161n * E18);
  // someone withdraws the 1-LTH note directly first (e.g. from another device)
  const n1 = found.notes.find((x) => x.value === 1);
  await sdk.withdrawNote(bob, n1.pool, n1.note, fresh(), { circuit: c8 });
  const stale = found;   // the earlier scan still shows the 1-LTH note unspent
  const rcpt = fresh(), relR = fresh();
  const wb = await sdk.withdrawByAmount(bob, R('v8'), dep.masterKey, 111, rcpt, { circuit: c8, relayer: relR, fee: E18 / 10n, notes: stale });
  ok('withdrawByAmount 111 with an out-of-date scan: the router skips the note already withdrawn and pays 100 + 10; fees bound per note', (await bal(rcpt)) === 110n * E18 - 2n * E18 / 10n && (await bal(relR)) === 2n * E18 / 10n && wb.skipped && wb.skipped.length === 1 && wb.skipped[0].nullifierHash === n1.nullifierHash);
  const after = await sdk.findNotes(provider, R('v8'), dep.masterKey);
  ok('findNotes afterwards: only the 50-LTH note is left', after.unspent.length === 1 && after.unspent[0].value === 50);
  const rcpt2 = fresh();
  await sdk.withdrawByAmount(provider, R('v8'), dep.masterKey, 50, rcpt2, { circuit: c8, viaRelayer: true });
  ok('withdrawByAmount 50 through the relayer: the empty address gets 50 LTH', (await bal(rcpt2)) === 50n * E18);

  console.log('\none master key across V7 and V8');
  const m2 = sdk.randomFieldElement();
  const dep7 = await sdk.depositAny(alice, R('v7'), 11n * E18, { master: m2 });
  const dep8 = await sdk.depositAny(alice, R('v8'), 60n * E18, { master: m2 });
  const all = await sdk.findNotesAll(provider, REG, dep7.masterKey, { minBlock: dep8.receipt.blockNumber });
  const sumBy = (v) => all.notes.filter((x) => x.router.version === v).reduce((s, x) => s + x.value, 0);
  ok('findNotesAll with the V7 master key finds its 11 LTH in V7 and the 60 LTH deposited under the same master in V8', sumBy('v7') === 11 && sumBy('v8') === 60 && all.unspent.length === 4);
  ok('findNotes on the V8 router with the V7 master key text is refused (the key names another router)', await rejects(() => sdk.findNotes(provider, R('v8'), dep7.masterKey), /belongs to router/));

  console.log('\ndisclosure');
  const cd2 = await sdk.loadCircuit('disclose_v2'), cdl = await sdk.loadCircuit('disclose_link');
  const nonce = 123456789n;
  const pd = await sdk.proveDisclose(sdk.buildDiscloseInput({ spendKey: d2.spendKey, viewKey: d2.viewKey, auditorNonce: nonce, version: 'v8' }), cd2);
  const DV = new ethers.Contract(P('v8', 10).discloseVerifierAddr, sdk.VERIFIER_ABI.disclose_v2, provider);
  ok('disclose_v2: the deployed verifier accepts the proof for a deposited V8 note; another auditor code is refused', await DV.verifyProof(pd.pA, pd.pB, pd.pC, pd.pubSignals) && !(await DV.verifyProof(pd.pA, pd.pB, pd.pC, [pd.pubSignals[0], pd.pubSignals[1], (nonce + 1n).toString()])));
  const pl = await sdk.proveDiscloseLink(sdk.buildDiscloseLinkInput({ spendKey: d2.spendKey, viewKey: d2.viewKey, ctx: sdk.contextOf(P('v8', 10)), auditorNonce: nonce }), cdl);
  const DL = new ethers.Contract(P('v8', 10).discloseLinkVerifierAddr, sdk.VERIFIER_ABI.disclose_link, provider);
  ok('disclose_link: accepted, and its nullifier is the one in the pool\'s Withdrawal event of that note (a receipt)', await DL.verifyProof(pl.pA, pl.pB, pl.pC, pl.pubSignals) && BigInt(pl.pubSignals[1]) === BigInt(w2.proof.pubSignals[1]));
  ok('buildReport refuses V8 notes for now (the report file format is V5–V7)', await rejects(() => sdk.buildReport({ net: REG.networks.local, auditorNonce: nonce, notes: [{ pool: P('v8', 10), spendKey: d2.spendKey, viewKey: d2.viewKey, leafIndex: 1, depositTime: 1 }], circuit: cd2 }), /V8 notes/));

  console.log('\nexamples/v8-flow.js on the local chain');
  const ex = await require('../examples/v8-flow.js').run({ signer: alice, provider, registry: REG, log: (m) => console.log('   ' + m) });
  ok('examples/v8-flow.js runs end to end (' + ex.checks.length + ' checks of its own)', ex.failed === 0 && ex.checks.length === 8);

  await new Promise((r) => server.close(r));
  console.log(fails ? '\n' + fails + ' of ' + n + ' FAILED' : '\nALL ' + n + ' CHECKS PASSED');
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error('ERROR', e); process.exit(1); });
