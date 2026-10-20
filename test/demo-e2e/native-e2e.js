// Browser end-to-end test for the demo on a network whose gas coin is the pooled token (the native-coin pools
// LatheonShieldedPoolV5Native and LatheonDistributionPoolNative). A local chain with the native pools and router, next to
// an ordinary ERC-20 network, a mock wallet that does not know the native network yet, and real Groth16 proofs.
// Needs the same setup as router-e2e.js (see README.md).
//   DEMO=/path/to/demo node native-e2e.js
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
};
const linked = (c, libs) => { let code = c.evm.bytecode.object; const refs = c.evm.bytecode.linkReferences; for (const f in refs) for (const l in refs[f]) for (const { start, length } of refs[f][l]) code = code.slice(0, start * 2) + libs[l].slice(2).toLowerCase() + code.slice(start * 2 + length * 2); return code; };
// The native network uses the Latheon test chain's real chainId; the wallet does not know it until the demo adds it.
const CHAINS = { 'ethereum-sepolia': { id: 11155111, hex: '0xaa36a7' }, 'latheon-testnet': { id: 60531373273, hex: '0xe17f374d9' } };
const E18 = 10n ** 18n;
const ERC20 = ['function balanceOf(address) view returns (uint256)'];
const FAUCET_PAGE = 'https://explorer.testnet.latheon.test/faucet';

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
      const ver5 = await d(C.Ver5);
      const pools = {}, ps = [];
      if (k === 'latheon-testnet') {
        for (const a of [100, 50, 10, 1]) { const p = await d(C.Pool5N, [ver5.addr, BigInt(a) * E18], libs); pools['LTH-' + a] = p; ps.push(p.addr); }
        dep[k] = { ver5, pools, router: await d(C.DistN, [ps]) };
      } else {
        const lth = await d(C.Token, [me]);
        for (const a of [100, 50, 10, 1]) { const p = await d(C.Pool5, [lth.addr, ver5.addr, BigInt(a) * E18], libs); pools['LTH-' + a] = p; ps.push(p.addr); }
        dep[k] = { ver5, pools, lth, router: await d(C.Dist, [lth.addr, ps]) };
      }
      say('  ' + k + ': 4 pools and a router deployed');
    }
    const net = (k, extra) => Object.assign({ name: k === 'latheon-testnet' ? 'Latheon Testnet' : 'Ethereum Sepolia', chainId: CHAINS[k].id, chainIdHex: CHAINS[k].hex,
      rpcUrl: 'https://rpc.' + k + '.test', explorerUrl: 'https://explorer.' + k + '.test', v5Verifier: dep[k].ver5.addr, discloseVerifier: dep[k].ver5.addr }, extra);
    const cfg = {
      schema: 1, generated: 'test',
      networks: {
        'ethereum-sepolia': net('ethereum-sepolia', { tokens: { LTH: { address: dep['ethereum-sepolia'].lth.addr, decimals: 18 } } }),
        'latheon-testnet': net('latheon-testnet', {
          nativeCurrency: { name: 'LTH (test)', symbol: 'LTH', decimals: 18 },
          tokens: { LTH: { address: ethers.ZeroAddress, decimals: 18, native: true, faucetPage: FAUCET_PAGE } },
        }),
      },
      pools: [], routers: [],
    };
    for (const k of Object.keys(CHAINS)) {
      for (const a of [100, 50, 10, 1]) { const p = dep[k].pools['LTH-' + a]; cfg.pools.push({ id: k + ':LTH-' + a, network: k, version: k === 'latheon-testnet' ? 'v5-native' : 'v5', token: 'LTH', amount: a, address: p.addr, deployBlock: p.block }); }
      cfg.routers.push({ id: k + ':LTH', network: k, token: 'LTH', native: k === 'latheon-testnet' || undefined, address: dep[k].router.addr, deployBlock: dep[k].router.block });
    }
    const cfgJson = JSON.stringify(cfg);

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
    const V3 = REPO + '/circuits/build/withdraw_v3/';
    const FILES = {
      'https://cdn.jsdelivr.net/gh/latheon-network/latheon@main/circuits/build/withdraw_v3/withdraw_v3.wasm': V3 + 'withdraw_v3.wasm',
      'https://cdn.jsdelivr.net/gh/latheon-network/latheon@main/circuits/build/withdraw_v3/withdraw_v3_final.zkey': V3 + 'withdraw_v3_final.zkey',
    };
    const BUNDLES = { 'https://esm.run/ethers': 'ethers', 'https://esm.run/poseidon-lite': 'poseidon', 'https://esm.run/snarkjs': 'snarkjs' };
    const cors = { 'access-control-allow-origin': '*' };
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (url === 'https://latheon.test/demo/') return route.fulfill({ status: 200, contentType: 'text/html', body: rd(DEMO + '/index.html') });
      if (url === 'https://latheon.test/demo/deployments.json') return route.fulfill({ status: 200, contentType: 'application/json', body: cfgJson });
      if (BUNDLES[url]) return route.fulfill({ status: 200, contentType: 'application/javascript', headers: cors, body: rd(__dirname + '/bundles/' + BUNDLES[url] + '.mjs') });
      if (FILES[url]) return route.fulfill({ status: 200, contentType: 'application/octet-stream', headers: cors, body: fs.readFileSync(FILES[url]) });
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
    });

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
    await page.fill('#noteInput', note); await page.fill('#recipientInput', r1); await page.click('#withdrawBtn');
    await waitText('#withdrawStatus', /Withdrawal successful|Failed/);
    rec('N7. The note withdrawn to an empty address: it now holds exactly 10 LTH, the pool 0', (await coin(r1)) === 10n * E18 && (await poolCoin(10)) === 0n, (await page.textContent('#withdrawStatus')).trim().slice(0, 70));

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
    await page.click('#waGoBtn'); await waitText('#waStatus', /Withdrawn|Failed/);
    const ws = (await page.textContent('#waStatus')).trim();
    rec('N10. Withdraw 161 by amount and key to an empty address: it holds exactly 161 LTH', /Withdrawn 161 LTH/.test(ws) && (await coin(r2)) === 161n * E18, ws.slice(0, 70));

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
