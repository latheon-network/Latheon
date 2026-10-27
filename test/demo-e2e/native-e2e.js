// Browser end-to-end test for the demo on a network whose gas coin is the pooled token (the native-coin pools
// LatheonShieldedPoolV5Native and LatheonDistributionPoolNative). A local chain with the native pools and router, next to
// an ordinary ERC-20 network, a mock wallet that does not know the native network yet, and real Groth16 proofs.
// Needs the same setup as router-e2e.js (see README.md).
//   DEMO=/path/to/demo node native-e2e.js          (V5 native pools and router)
//   V6=1 DEMO=/path/to/demo node native-e2e.js     (the same run on V6: 20-level trees, withdraw_v4, relayer and fee in the proof)
//   V7=1 DEMO=/path/to/demo node native-e2e.js     (V7: withdraw_v5, the pathIndices fix; same interface as V6)
const GEN = process.env.V7 === '1' ? 'v7' : process.env.V6 === '1' ? 'v6' : 'v5';
const V6 = GEN !== 'v5';   // fee-bearing interface (V6 and V7 share it); V7 only fixes the circuit
const V7 = GEN === 'v7';
const fs = require('fs'), path = require('path');
const NM = path.resolve(__dirname, '..', 'distribution', 'node_modules');
const req = (m) => require(path.join(NM, m));
const solc = req('solc'), ganache = req('ganache'), { ethers } = req('ethers');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || '/usr/lib/node_modules/playwright')); }
const REPO = path.resolve(__dirname, '..', '..');
if (!process.env.DEMO) { console.log('Set DEMO to the folder that holds index.html'); process.exit(2); }
const DEMO = process.env.DEMO;
const SHOTS = process.env.SHOTS || path.join(require('os').tmpdir(), 'latheon-demo-shots'); fs.mkdirSync(SHOTS, { recursive: true });
const rd = (p) => fs.readFileSync(p, 'utf8');
const say = (...a) => console.log(...a);
const sources = {
  'contracts/V5.sol': { content: rd(REPO + '/contracts/LatheonShieldedPoolV5.sol') },
  'contracts/V5N.sol': { content: rd(REPO + '/contracts/LatheonShieldedPoolV5Native.sol') },
  'contracts/Dist.sol': { content: rd(REPO + '/contracts/LatheonDistributionPool.sol') },
  'contracts/DistN.sol': { content: rd(REPO + '/contracts/LatheonDistributionPoolNative.sol') },
  'contracts/PoseidonT3.sol': { content: rd(REPO + '/contracts/PoseidonT3.sol') },
  'contracts/Token.sol': { content: rd(REPO + '/contracts/LatheonToken.sol') },
  'contracts/VerifierV5.sol': { content: rd(REPO + '/contracts/WithdrawVerifierV3.sol') },
  'contracts/V6N.sol': { content: rd(REPO + '/contracts/LatheonShieldedPoolV6Native.sol') },
  'contracts/Dist6N.sol': { content: rd(REPO + '/contracts/LatheonDistributionPoolV6Native.sol') },
  'contracts/VerifierV4.sol': { content: rd(REPO + '/contracts/WithdrawVerifierV4.sol') },
  'contracts/V7N.sol': { content: rd(REPO + '/contracts/LatheonShieldedPoolV7Native.sol') },
  'contracts/Dist7N.sol': { content: rd(REPO + '/contracts/LatheonDistributionPoolV7Native.sol') },
  'contracts/VerifierV5c.sol': { content: rd(REPO + '/contracts/WithdrawVerifierV5.sol') },
};
const imp = (p) => { const f = path.join(NM, p); return fs.existsSync(f) ? { contents: rd(f) } : { error: 'nf ' + p }; };
say('Compiling…');
const out = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.bytecode.linkReferences'] } } } }), { import: imp }));
if ((out.errors || []).some((e) => e.severity === 'error')) { say(out.errors.filter((e) => e.severity === 'error').map((e) => e.formattedMessage).join('\n')); process.exit(1); }
const K = (f, n) => out.contracts['contracts/' + f][n];
const C = {
  Pool5: K('V5.sol', 'LatheonShieldedPoolV5'), Pool5N: K('V5N.sol', 'LatheonShieldedPoolV5Native'),
  Dist: K('Dist.sol', 'LatheonDistributionPool'), DistN: K('DistN.sol', 'LatheonDistributionPoolNative'),
  Poseidon: K('PoseidonT3.sol', 'PoseidonT3'), Token: K('Token.sol', 'LatheonToken'), Ver5: K('VerifierV5.sol', 'Groth16Verifier'),
  Pool6N: K('V6N.sol', 'LatheonShieldedPoolV6Native'), Dist6N: K('Dist6N.sol', 'LatheonDistributionPoolV6Native'), Ver4: K('VerifierV4.sol', 'WithdrawVerifierV4'),
  Pool7N: K('V7N.sol', 'LatheonShieldedPoolV7Native'), Dist7N: K('Dist7N.sol', 'LatheonDistributionPoolV7Native'), Ver5c: K('VerifierV5c.sol', 'WithdrawVerifierV5'),
};
const linked = (c, libs) => { let code = c.evm.bytecode.object; const refs = c.evm.bytecode.linkReferences; for (const f in refs) for (const l in refs[f]) for (const { start, length } of refs[f][l]) code = code.slice(0, start * 2) + libs[l].slice(2).toLowerCase() + code.slice(start * 2 + length * 2); return code; };
// The native network uses the Latheon test chain's real chainId; the wallet does not know it until the demo adds it.
const CHAINS = { 'ethereum-sepolia': { id: 11155111, hex: '0xaa36a7' }, 'latheon-testnet': { id: 60531373273, hex: '0xe17f374d9' } };
const E18 = 10n ** 18n;
const ERC20 = ['function balanceOf(address) view returns (uint256)'];
const FAUCET_PAGE = 'https://explorer.testnet.latheon.test/faucet';
const RELAY = 'https://relay.test/relay/api';
const RELAY_POOL = V6 ? ['function withdraw(uint256[2] _pA, uint256[2][2] _pB, uint256[2] _pC, uint256 root, uint256 nullifierHash, address recipient, address relayer, uint256 fee)']
  : ['function withdraw(uint256[2] _pA, uint256[2][2] _pB, uint256[2] _pC, uint256 root, uint256 nullifierHash, address recipient)'];
const RELAY_ROUTER = V6 ? ['function withdrawMany((uint256 pool, uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256 root, uint256 nullifierHash, uint256 fee)[] items, address recipient, address relayer)']
  : ['function withdrawMany((uint256 pool, uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256 root, uint256 nullifierHash)[] items, address recipient)'];

(async () => {
  const results = []; const rec = (n, ok, note) => { results.push([n, ok]); say((ok ? 'PASS ' : 'FAIL ') + n + (note ? '   [' + note + ']' : '')); };
  let browser, page; const consoleMsgs = [], pageErrors = [];
  try {
    const providers = {}, eth = {}, dep = {};
    for (const [k, c] of Object.entries(CHAINS)) {
      providers[k] = ganache.provider({ logging: { quiet: true }, chain: { chainId: c.id, networkId: c.id, hardfork: 'shanghai' }, wallet: { deterministic: true, defaultBalance: 100000 }, miner: { blockGasLimit: 60000000 } });
      eth[k] = new ethers.BrowserProvider(providers[k]);
    }
    const accounts = await providers['ethereum-sepolia'].request({ method: 'eth_accounts', params: [] });
    // fresh recipients with no coin at all (the demo pays them out of the pool)
    const fresh = (i) => ethers.getAddress(ethers.dataSlice(ethers.keccak256(ethers.toUtf8Bytes('native-e2e-recipient-' + i)), 12));
    for (const k of Object.keys(CHAINS)) {
      const s = await eth[k].getSigner(0), me = await s.getAddress();
      const d = async (c, args = [], libs = {}) => { const f = new ethers.ContractFactory(c.abi, '0x' + linked(c, libs), s); const x = await f.deploy(...args); const rc = await x.deploymentTransaction().wait(); return { c: x, addr: await x.getAddress(), block: rc.blockNumber }; };
      const lib = await d(C.Poseidon), libs = { PoseidonT3: lib.addr };
      const ver5 = await d(k === 'latheon-testnet' && V7 ? C.Ver5c : k === 'latheon-testnet' && V6 ? C.Ver4 : C.Ver5);
      const pools = {}, ps = [];
      if (k === 'latheon-testnet') {
        for (const a of [100, 50, 10, 1]) { const p = await d(V7 ? C.Pool7N : V6 ? C.Pool6N : C.Pool5N, [ver5.addr, BigInt(a) * E18], libs); pools['LTH-' + a] = p; ps.push(p.addr); }
        dep[k] = { ver5, pools, router: await d(V7 ? C.Dist7N : V6 ? C.Dist6N : C.DistN, [ps]) };
      } else {
        const lth = await d(C.Token, [me]);
        for (const a of [100, 50, 10, 1]) { const p = await d(C.Pool5, [lth.addr, ver5.addr, BigInt(a) * E18], libs); pools['LTH-' + a] = p; ps.push(p.addr); }
        dep[k] = { ver5, pools, lth, router: await d(C.Dist, [lth.addr, ps]) };
      }
      say('  ' + k + ': 4 pools and a router deployed');
    }
    const net = (k, extra) => Object.assign({ name: k === 'latheon-testnet' ? 'Latheon Testnet' : 'Ethereum Sepolia', chainId: CHAINS[k].id, chainIdHex: CHAINS[k].hex,
      rpcUrl: 'https://rpc.' + k + '.test', explorerUrl: 'https://explorer.' + k + '.test', v5Verifier: dep[k].ver5.addr, discloseVerifier: dep[k].ver5.addr }, k === 'latheon-testnet' && V7 ? { v7Verifier: dep[k].ver5.addr } : k === 'latheon-testnet' && V6 ? { v6Verifier: dep[k].ver5.addr } : {}, extra);
    const cfg = {
      schema: 1, generated: 'test',
      networks: {
        'ethereum-sepolia': net('ethereum-sepolia', { tokens: { LTH: { address: dep['ethereum-sepolia'].lth.addr, decimals: 18 } } }),
        'latheon-testnet': net('latheon-testnet', {
          nativeCurrency: { name: 'LTH (test)', symbol: 'LTH', decimals: 18 }, relayer: RELAY,
          tokens: { LTH: { address: ethers.ZeroAddress, decimals: 18, native: true, faucetPage: FAUCET_PAGE } },
        }),
      },
      pools: [], routers: [],
    };
    for (const k of Object.keys(CHAINS)) {
      for (const a of [100, 50, 10, 1]) { const p = dep[k].pools['LTH-' + a]; cfg.pools.push({ id: k + ':LTH-' + a, network: k, version: k === 'latheon-testnet' ? (V7 ? 'v7-native' : V6 ? 'v6-native' : 'v5-native') : 'v5', token: 'LTH', amount: a, address: p.addr, deployBlock: p.block }); }
      cfg.routers.push({ id: k + ':LTH', network: k, token: 'LTH', native: k === 'latheon-testnet' || undefined, version: k === 'latheon-testnet' ? (V7 ? 'v7' : V6 ? 'v6' : undefined) : undefined, address: dep[k].router.addr, deployBlock: dep[k].router.block });
    }
    const cfgJson = JSON.stringify(cfg);
    // a stand-in for the network's relayer: sends what it is given from its own account (index 3)
    const relayed = [];
    const relaySigner = await eth['latheon-testnet'].getSigner(3), relayAddr = await relaySigner.getAddress();
    // Stale-root drill: when floodNext names a pool, the next relayed withdrawal first gets HIST deposits into that pool
    // (random commitments from account 4), so the pool forgets the root the proof was made against and refuses it with
    // "Unknown root". The demo must make a new proof and succeed on its own.
    const HIST = V6 ? 100 : 30, FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
    let floodNext = null, relayCalls = 0;
    const flooder = await eth['latheon-testnet'].getSigner(4);
    async function flood(poolAddr, amount) {
      const c = new ethers.Contract(poolAddr, ['function deposit(uint256 commitment) payable'], flooder);
      for (let i = 0; i < HIST; i++) await (await c.deposit(BigInt(ethers.hexlify(ethers.randomBytes(32))) % FIELD, { value: amount })).wait();
    }
    async function relayRoute(route) {
      const h = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, OPTIONS' };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: h });
      const url = route.request().url(), b = JSON.parse(route.request().postData() || '{}');
      relayCalls++;
      if (floodNext) { const f = floodNext; floodNext = null; await flood(f.addr, f.amount); }
      try {
        const Z = ethers.ZeroAddress;
        const [c, fn, args] = url.endsWith('/withdrawMany') ? [new ethers.Contract(b.router, RELAY_ROUTER, relaySigner), 'withdrawMany', [b.items, b.recipient, ...(V6 ? [b.relayer || Z] : [])]]
          : [new ethers.Contract(b.pool, RELAY_POOL, relaySigner), 'withdraw', [b.pA, b.pB, b.pC, b.root, b.nullifierHash, b.recipient, ...(V6 ? [b.relayer || Z, b.fee || 0] : [])]];
        try { await c[fn].staticCall(...args); } catch (e) { throw new Error('Refused before sending (the chain would reject it): ' + (e.reason || e.shortMessage || e.message)); }   // as the real relayer does
        const tx = await c[fn](...args);
        const rc = await tx.wait(); relayed.push(tx.hash);
        return route.fulfill({ status: 200, contentType: 'application/json', headers: h, body: JSON.stringify({ tx: tx.hash, gasUsed: rc.gasUsed.toString() }) });
      } catch (e) { return route.fulfill({ status: 400, contentType: 'application/json', headers: h, body: JSON.stringify({ error: (e.message || e.shortMessage).slice(0, 160) }) }); }
    }

    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    page = await ctx.newPage();
    page.on('console', (m) => consoleMsgs.push(m.type() + ': ' + m.text().slice(0, 300)));
    page.on('pageerror', (e) => pageErrors.push(e.message));
    let current = 'ethereum-sepolia';
    const known = new Set(['ethereum-sepolia']); const added = [];
    await page.exposeFunction('__rpc', async (method, paramsJson) => {
      const params = JSON.parse(paramsJson || '[]');
      try {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return JSON.stringify({ result: [accounts[0]] });
        if (method === 'eth_chainId') return JSON.stringify({ result: CHAINS[current].hex });
        if (method === 'net_version') return JSON.stringify({ result: String(CHAINS[current].id) });
        if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') {
          const k = Object.keys(CHAINS).find((x) => CHAINS[x].hex === String(params[0].chainId).toLowerCase());
          if (method === 'wallet_addEthereumChain') { added.push(params[0]); if (k) known.add(k); }
          if (!k || !known.has(k)) return JSON.stringify({ error: { code: 4902, message: 'Unrecognized chain ID' } });
          current = k; return JSON.stringify({ result: null });
        }
        return JSON.stringify({ result: await providers[current].request({ method, params }) });
      } catch (e) { return JSON.stringify({ error: { code: e.code || -32000, message: e.message || String(e) } }); }
    });
    await page.addInitScript(() => { window.ethereum = { isMetaMask: true, request: async ({ method, params }) => { const r = JSON.parse(await window.__rpc(method, JSON.stringify(params || []))); if (r.error) { const e = new Error(r.error.message); e.code = r.error.code; throw e; } return r.result; }, on() {}, removeListener() {} }; });
    const V3 = REPO + '/circuits/build/withdraw_v3/', V4 = REPO + '/circuits/build/withdraw_v4/', V5c = REPO + '/circuits/build/withdraw_v5/';
    const FILES = {
      'https://cdn.jsdelivr.net/gh/latheon-network/latheon@main/circuits/build/withdraw_v5/withdraw_v5.wasm': V5c + 'withdraw_v5.wasm',
      'https://cdn.jsdelivr.net/gh/latheon-network/latheon@main/circuits/build/withdraw_v5/withdraw_v5_final.zkey': V5c + 'withdraw_v5_final.zkey',
      'https://cdn.jsdelivr.net/gh/latheon-network/latheon@main/circuits/build/withdraw_v4/withdraw_v4.wasm': V4 + 'withdraw_v4.wasm',
      'https://cdn.jsdelivr.net/gh/latheon-network/latheon@main/circuits/build/withdraw_v4/withdraw_v4_final.zkey': V4 + 'withdraw_v4_final.zkey',
      'https://cdn.jsdelivr.net/gh/latheon-network/latheon@main/circuits/build/withdraw_v3/withdraw_v3.wasm': V3 + 'withdraw_v3.wasm',
      'https://cdn.jsdelivr.net/gh/latheon-network/latheon@main/circuits/build/withdraw_v3/withdraw_v3_final.zkey': V3 + 'withdraw_v3_final.zkey',
    };
    const BUNDLES = { 'https://esm.run/ethers': 'ethers', 'https://esm.run/poseidon-lite': 'poseidon', 'https://esm.run/snarkjs': 'snarkjs' };
    const cors = { 'access-control-allow-origin': '*' };
    const routeAll = async (route) => {
      const url = route.request().url();
      if (url === 'https://latheon.test/demo/') return route.fulfill({ status: 200, contentType: 'text/html', body: rd(DEMO + '/index.html') });
      if (url === 'https://latheon.test/demo/deployments.json') return route.fulfill({ status: 200, contentType: 'application/json', body: cfgJson });
      if (BUNDLES[url]) return route.fulfill({ status: 200, contentType: 'application/javascript', headers: cors, body: rd(__dirname + '/bundles/' + BUNDLES[url] + '.mjs') });
      if (FILES[url]) return route.fulfill({ status: 200, contentType: 'application/octet-stream', headers: cors, body: fs.readFileSync(FILES[url]) });
      if (url.startsWith(RELAY + '/')) return relayRoute(route);
      const rk = Object.entries(cfg.networks).find(([, n]) => url.startsWith(n.rpcUrl));
      if (rk) {
        const h = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: h });
        const body = JSON.parse(route.request().postData() || '{}');
        const one = async (q) => { try { return { jsonrpc: '2.0', id: q.id, result: await providers[rk[0]].request({ method: q.method, params: q.params }) }; } catch (e) { return { jsonrpc: '2.0', id: q.id, error: { code: e.code || -32000, message: e.message } }; } };
        const outp = Array.isArray(body) ? await Promise.all(body.map(one)) : await one(body);
        return route.fulfill({ status: 200, contentType: 'application/json', headers: h, body: JSON.stringify(outp) });
      }
      return route.abort();
    };
    await page.route('**/*', routeAll);

    const N = 'latheon-testnet';
    const waitText = (sel, re, ms = 240000) => page.waitForFunction(([s, r]) => new RegExp(r).test((document.querySelector(s) || {}).textContent || ''), [sel, re.source], { timeout: ms });
    const coin = (who) => eth[N].getBalance(who);
    const poolCoin = (a) => eth[N].getBalance(dep[N].pools['LTH-' + a].addr);
    const pickNT = async (n, tok) => { await page.click('#tab-deposit'); await page.click('#depMode-fixed'); await page.selectOption('#netSelect', n); await page.selectOption('#tokSelect', tok); await page.waitForTimeout(500); };
    const stepTexts = (id) => page.$$eval('#' + id + ' li span:first-child', (els) => els.map((e) => e.textContent.trim()));

    await page.goto('https://latheon.test/demo/');
    await waitText('#poolInfo', /contract 0x/, 60000);
    const nets = await page.$$eval('#netSelect option', (o) => o.map((x) => x.value).join());
    rec('N0. Both networks listed; native pools (v5-native) are accepted as V5 pools', nets === 'ethereum-sepolia,latheon-testnet' && !pageErrors.length, nets);
    await page.click('#connectBtn'); await waitText('#walletStatus', /Connected to/, 60000);
    rec('N1. ERC-20 network: gas-coin row shown as "ETH balance (gas)"', await page.isVisible('#gasRow') && /ETH balance \(gas\)/.test(await page.textContent('#gasLabelOut')), await page.textContent('#gasLabelOut'));

    await pickNT(N, 'LTH'); await page.selectOption('#poolSelect', N + ':LTH-10'); await page.waitForTimeout(500);
    const fnote = (await page.textContent('#externalFaucetNote')).replace(/\s+/g, ' ').trim();
    rec('N2. Native network: faucet note points to the faucet page', /faucet page/.test(fnote) && (await page.getAttribute('#externalFaucetLink', 'href')) === FAUCET_PAGE, fnote.slice(0, 80));

    // ---- fixed pool: deposit 10 LTH with msg.value, no approve; the wallet first has to add the network
    const before = await coin(accounts[0]);
    await page.click('#depositBtn');
    await page.waitForFunction(() => { const e = document.getElementById('noteText'); return e && e.textContent.trim(); }, null, { timeout: 240000 });
    const note = (await page.textContent('#noteText')).trim();
    const add = added.find((p) => p.chainId === CHAINS[N].hex);
    rec('N3. The wallet was asked to add the network with LTH as its own coin', !!add && add.nativeCurrency && add.nativeCurrency.symbol === 'LTH' && add.rpcUrls[0] === cfg.networks[N].rpcUrl, add ? JSON.stringify(add.nativeCurrency) : 'not added');
    const steps = await stepTexts('depSteps');
    rec('N4. Deposit steps say "Check the pool" and "No approval needed"', steps[0] === 'Check the pool' && /No approval needed/.test(steps[1]), steps.join(' | '));
    const after = await coin(accounts[0]);
    rec('N5. Deposit 10 LTH: the pool holds 10 LTH, the wallet paid 10 LTH plus gas, note names the native pool',
      (await poolCoin(10)) === 10n * E18 && before - after > 10n * E18 && before - after < 10n * E18 + E18 / 10n && note.startsWith('latheon-v5:' + CHAINS[N].id + ':' + dep[N].pools['LTH-10'].addr + ':'), ethers.formatEther(before - after) + ' LTH spent');
    rec('N6. The token row shows the wallet\'s LTH; the separate gas row is hidden', !(await page.isVisible('#gasRow')) && /LTH balance/.test(await page.textContent('#tokenLabelOut')) && /LTH$/.test((await page.textContent('#tokenOut')).trim()), (await page.textContent('#tokenOut')).trim());

    const r1 = fresh(1);
    await page.click('#tab-withdraw'); await page.click('#wdMode-one');
    await page.evaluate(() => { document.getElementById('withdrawStatus').textContent = ''; });
    const relayShown = await page.isVisible('#relayRow') && await page.isChecked('#useRelay');
    await page.uncheck('#useRelay');   // this one from the connected wallet; the relayer is tested below
    await page.fill('#noteInput', note); await page.fill('#recipientInput', r1); await page.click('#withdrawBtn');
    await waitText('#withdrawStatus', /Withdrawal successful|Failed/);
    rec('N7. The note withdrawn to an empty address from the wallet (relayer box unticked): it now holds exactly 10 LTH, the pool 0',
      relayShown && (await coin(r1)) === 10n * E18 && (await poolCoin(10)) === 0n && relayed.length === 0, (await page.textContent('#withdrawStatus')).trim().slice(0, 70));
    await page.check('#useRelay');

    // ---- router: any amount in one transaction with msg.value, then withdraw by amount and master key
    await page.click('#tab-deposit');
    if (await page.locator('#noteSavedChk').count()) await page.check('#noteSavedChk');   // the demo waits until the last note is saved
    await page.click('#depMode-any');
    if (await page.locator('#keySavedChk').count()) { const c = page.locator('#keySavedChk'); if (!(await c.isChecked())) await c.check(); }
    await page.fill('#daAmount', '161'); await page.check('input[name="daRound"][value="exact"]'); await page.waitForTimeout(200);
    const prev = (await page.textContent('#daPreview')).trim();
    await page.click('#daDepositBtn');
    await page.waitForFunction(() => { const e = document.getElementById('masterText'); return e && e.textContent.trim(); }, null, { timeout: 240000 });
    const key = (await page.textContent('#masterText')).trim();
    const dsteps = await stepTexts('depAnySteps');
    const pc = [await poolCoin(100), await poolCoin(50), await poolCoin(10), await poolCoin(1)];
    rec('N8. Router deposit of 161: 1×100 + 1×50 + 1×10 + 1×1 in the pools, router holds nothing, no approval step',
      /1×100 \+ 1×50 \+ 1×10 \+ 1×1/.test(prev) && pc.join() === [100n, 50n, 10n, 1n].map((x) => (x * E18).toString()).join() && (await eth[N].getBalance(dep[N].router.addr)) === 0n && /No approval needed/.test(dsteps[1]),
      dsteps[1] + ' / ' + prev.slice(0, 60));
    rec('N9. Master key names the native router on the Latheon chainId', key.startsWith('latheon-master:' + CHAINS[N].id + ':' + dep[N].router.addr + ':'), key.slice(0, 50) + '…');
    const r2 = fresh(2);
    await page.click('#tab-withdraw'); await page.click('#wdMode-any');
    await page.fill('#waKey', key); await page.fill('#waAmount', '161'); await page.fill('#waRecipient', r2);
    await page.click('#waFindBtn'); await page.waitForFunction(() => !document.getElementById('waFindBtn').disabled, null, { timeout: 120000 });
    const userBefore10 = await coin(accounts[0]);
    floodNext = { addr: dep[N].pools['LTH-1'].addr, amount: E18 }; const calls10 = relayCalls;
    await page.click('#waGoBtn'); await waitText('#waStatus', /Withdrawn|Failed/, 1200000);   // includes the stale-root drill (HIST deposits)
    const ws = (await page.textContent('#waStatus')).trim();
    const tx10 = relayed.length ? await eth[N].getTransaction(relayed[relayed.length - 1]) : null;
    rec('N10. Withdraw 161 by amount and key through the relayer: the empty address holds exactly 161 LTH, the transaction comes from the relayer, the user paid nothing',
      /Withdrawn 161 LTH/.test(ws) && (await coin(r2)) === 161n * E18 && tx10 && tx10.from === relayAddr && (await coin(accounts[0])) === userBefore10, ws.slice(0, 70));
    const log10 = await page.textContent('#log');
    rec(`N16. Router withdrawal survives a stale root: ${HIST} deposits landed in the 1 LTH pool between proving and sending, the relayer was refused once ("Unknown root"), the demo made new proofs and the second attempt paid`,
      /no longer knows the root/.test(log10) && relayCalls - calls10 === 2 && (await coin(r2)) === 161n * E18, 'relayer calls ' + (relayCalls - calls10));

    // ---- a visitor with NO wallet at all withdraws a note through the relayer
    await page.click('#tab-deposit'); await page.click('#depMode-any');
    if (await page.locator('#keySavedChk').count() && !(await page.isChecked('#keySavedChk'))) await page.check('#keySavedChk');   // the demo waits until the master key is saved
    await page.click('#depMode-fixed');
    if (await page.locator('#noteSavedChk').count() && !(await page.isChecked('#noteSavedChk'))) await page.check('#noteSavedChk');
    await page.selectOption('#poolSelect', N + ':LTH-1'); await page.waitForTimeout(400);
    const oldNote = (await page.textContent('#noteText')).trim();
    await page.click('#depositBtn');
    await page.waitForFunction((o) => { const e = document.getElementById('noteText'); return e && e.textContent.trim() && e.textContent.trim() !== o; }, oldNote, { timeout: 240000 });
    const note2 = (await page.textContent('#noteText')).trim();
    const page2 = await ctx.newPage(); const errs2 = []; page2.on('pageerror', (e) => errs2.push(e.message));
    await page2.route('**/*', routeAll);   // same files and endpoints, and no wallet injected at all
    await page2.goto('https://latheon.test/demo/'); await page2.waitForFunction(() => /contract 0x/.test(document.getElementById('poolInfo').textContent), null, { timeout: 60000 });
    await page2.click('#tab-withdraw'); await page2.click('#wdMode-one');
    const r3 = fresh(3);
    await page2.fill('#noteInput', note2); await page2.fill('#recipientInput', r3);
    const enabledNoWallet = !(await page2.isDisabled('#withdrawBtn'));
    floodNext = { addr: dep[N].pools['LTH-1'].addr, amount: E18 }; const calls15 = relayCalls;
    await page2.click('#withdrawBtn'); await page2.waitForFunction(() => /Withdrawal successful|Failed/.test(document.getElementById('withdrawStatus').textContent), null, { timeout: 1200000 });
    const st2 = (await page2.textContent('#withdrawStatus')).trim(); const steps2 = await page2.$$eval('#wdSteps li span:first-child', (e) => e.map((x) => x.textContent.trim()));
    rec('N15. Without any wallet: the withdraw button works, the step says "Send through the relayer", the empty address gets exactly 1 LTH',
      enabledNoWallet && /Withdrawal successful/.test(st2) && steps2[5] === 'Send through the relayer' && (await coin(r3)) === 1n * E18 && !errs2.length, st2.slice(0, 60) + (errs2.length ? ' | ' + errs2[0] : ''));
    const log15 = await page2.textContent('#log');
    rec(`N17. One-note withdrawal survives a stale root: ${HIST} deposits in the pool between proving and sending, refused once, new proof, paid on the second attempt`,
      /no longer knows the root/.test(log15) && relayCalls - calls15 === 2 && (await coin(r3)) === 1n * E18, 'relayer calls ' + (relayCalls - calls15));
    await page2.close();

    // ---- back to the ERC-20 network: approval step and gas row are back
    await pickNT('ethereum-sepolia', 'LTH');
    rec('N11. Back on the ERC-20 network the gas row is shown again', await page.isVisible('#gasRow'), '');
    await page.selectOption('#langSelect', 'ru'); await pickNT(N, 'LTH'); await page.waitForTimeout(300);
    const ru = (await page.textContent('#externalFaucetNote')).replace(/\s+/g, ' ').trim();
    rec('N12. Russian text for the faucet page note, no raw keys', /страница фаусета/.test(ru) && !/faucet\.|\{token\}/.test(ru), ru.slice(0, 80));
    await page.screenshot({ path: SHOTS + '/native-ru.png', fullPage: true });
    await page.selectOption('#langSelect', 'en');
    const raw = await page.evaluate(() => [...document.querySelectorAll('[data-i18n]')].filter((e) => e.getAttribute('data-i18n') === e.textContent.trim()).map((e) => e.getAttribute('data-i18n')));
    rec('N13. Every data-i18n element has a translation (no raw keys)', raw.length === 0, raw.join(','));
    rec('N14. No JavaScript errors in the whole run', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
  } catch (e) {
    say('TEST ERROR:', e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : e);
    try { say('--- console tail ---'); consoleMsgs.slice(-12).forEach((m) => say('  ' + m)); say('--- pageErrors: ' + pageErrors.join(' | ')); if (page) { say('--- log tail: ' + (await page.textContent('#log')).slice(-800)); await page.screenshot({ path: SHOTS + '/native-fail.png' }); } } catch (e2) {}
    rec('Test aborted', false, String(e && e.message).slice(0, 150));
  } finally {
    say('\nSUMMARY: ' + results.filter((r) => r[1]).length + '/' + results.length + ' passed' + (results.every((r) => r[1]) ? ' - ALL OK' : ' - FAILURES'));
    say('E2E_DONE');
    if (browser) await browser.close();
    process.exit(0);
  }
})();
