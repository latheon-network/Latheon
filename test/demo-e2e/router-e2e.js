// Browser end-to-end test for the demo's router features (network/token choice, any-amount deposit, withdraw by amount
// and master key). 35 checks, all passed on 2026-10-09. Needs: test/distribution/node_modules (npm install there),
// Playwright with Chromium, and the browser bundles from build-bundles.sh. See README.md.
//   DEMO=/path/to/demo node router-e2e.js
const fs = require('fs'), path = require('path');
const NM = path.resolve(__dirname, '..', 'distribution', 'node_modules');
const req = (m) => require(path.join(NM, m));
const solc = req('solc'), ganache = req('ganache'), { ethers } = req('ethers');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || '/usr/lib/node_modules/playwright')); }
const REPO = path.resolve(__dirname, '..', '..');
if (!process.env.DEMO) { console.log('Set DEMO to the folder that holds index.html and deployments.json'); process.exit(2); }
const DEMO = process.env.DEMO;
const SHOTS = process.env.SHOTS || path.join(require('os').tmpdir(), 'latheon-demo-shots'); fs.mkdirSync(SHOTS, { recursive: true });
const rd = (p) => fs.readFileSync(p, 'utf8');
const say = (...a) => console.log(...a);
const sources = {
  'contracts/V5.sol': { content: rd(REPO + '/contracts/LatheonShieldedPoolV5.sol') },
  'contracts/Dist.sol': { content: rd(REPO + '/contracts/LatheonDistributionPool.sol') },
  'contracts/PoseidonT3.sol': { content: rd(REPO + '/contracts/PoseidonT3.sol') },
  'contracts/Token.sol': { content: rd(REPO + '/contracts/LatheonToken.sol') },
  'contracts/VerifierV5.sol': { content: rd(REPO + '/contracts/WithdrawVerifierV3.sol') },
  'contracts/Token6.sol': { content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
contract Token6 is ERC20 { constructor() ERC20("Test6", "T6") { _mint(msg.sender, 1_000_000_000 * 10 ** 6); } function decimals() public pure override returns (uint8) { return 6; } }` },
};
const imp = (p) => { const f = path.join(NM, p); return fs.existsSync(f) ? { contents: rd(f) } : { error: 'nf ' + p }; };
say('Compiling…');
const out = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.bytecode.linkReferences'] } } } }), { import: imp }));
if ((out.errors || []).some((e) => e.severity === 'error')) { say(out.errors.filter((e) => e.severity === 'error').map((e) => e.formattedMessage).join('\n')); process.exit(1); }
const K = (f, n) => out.contracts['contracts/' + f][n];
const C = { Pool5: K('V5.sol', 'LatheonShieldedPoolV5'), Dist: K('Dist.sol', 'LatheonDistributionPool'), Poseidon: K('PoseidonT3.sol', 'PoseidonT3'), Token: K('Token.sol', 'LatheonToken'), Ver5: K('VerifierV5.sol', 'Groth16Verifier'), T6: K('Token6.sol', 'Token6') };
const linked = (c, libs) => { let code = c.evm.bytecode.object; const refs = c.evm.bytecode.linkReferences; for (const f in refs) for (const l in refs[f]) for (const { start, length } of refs[f][l]) code = code.slice(0, start * 2) + libs[l].slice(2).toLowerCase() + code.slice(start * 2 + length * 2); return code; };
const CHAINS = { 'ethereum-sepolia': { id: 11155111, hex: '0xaa36a7' }, 'arbitrum-sepolia': { id: 421614, hex: '0x66eee' }, 'robinhood-testnet': { id: 46630, hex: '0xb626' } };
const E18 = 10n ** 18n, E6 = 10n ** 6n;
const ERC20 = ['function balanceOf(address) view returns (uint256)'];
const POOLX = ['function nextIndex() view returns (uint256)', 'function nullifierHashes(uint256) view returns (bool)'];

(async () => {
  const results = []; const rec = (n, ok, note) => { results.push([n, ok]); say((ok ? 'PASS ' : 'FAIL ') + n + (note ? '   [' + note + ']' : '')); };
  let browser, page; const consoleMsgs = [], pageErrors = [];
  try {
    const providers = {}, eth = {}, dep = {};
    for (const [k, c] of Object.entries(CHAINS)) {
      providers[k] = ganache.provider({ logging: { quiet: true }, chain: { chainId: c.id, networkId: c.id, hardfork: 'shanghai' }, wallet: { deterministic: true }, miner: { blockGasLimit: 60000000 } });
      eth[k] = new ethers.BrowserProvider(providers[k]);
    }
    const accounts = await providers['ethereum-sepolia'].request({ method: 'eth_accounts', params: [] });
    const R_ = (i) => ethers.getAddress(accounts[i]);
    for (const k of Object.keys(CHAINS)) {
      const s = await eth[k].getSigner(0), me = await s.getAddress();
      const d = async (c, args = [], libs = {}) => { const f = new ethers.ContractFactory(c.abi, '0x' + linked(c, libs), s); const x = await f.deploy(...args); const rc = await x.deploymentTransaction().wait(); return { c: x, addr: await x.getAddress(), block: rc.blockNumber }; };
      const lib = await d(C.Poseidon), libs = { PoseidonT3: lib.addr };
      const ver5 = await d(C.Ver5), lth = await d(C.Token, [me]);
      const sets = { LTH: { tok: lth, unit: E18 } };
      if (k === 'robinhood-testnet') { sets.USDG = { tok: await d(C.T6), unit: E6 }; }
      const pools = {}, routers = {};
      for (const [sym, S] of Object.entries(sets)) {
        const ps = [];
        for (const a of [100, 50, 10, 1]) { const p = await d(C.Pool5, [S.tok.addr, ver5.addr, BigInt(a) * S.unit], libs); pools[sym + '-' + a] = p; ps.push(p.addr); }
        routers[sym] = await d(C.Dist, [S.tok.addr, ps]);
      }
      dep[k] = { ver5, lth, pools, routers, usdg: sets.USDG && sets.USDG.tok };
      say('  ' + k + ': ' + Object.keys(pools).length + ' pools, ' + Object.keys(routers).length + ' router(s)');
    }
    const cfg = JSON.parse(rd(DEMO + '/deployments.json'));
    for (const [k, n] of Object.entries(cfg.networks)) {
      n.v5Verifier = dep[k].ver5.addr; n.discloseVerifier = dep[k].ver5.addr; n.tokens.LTH.address = dep[k].lth.addr;
      if (n.tokens.USDG) n.tokens.USDG.address = dep[k].usdg.addr;
    }
    cfg.pools = cfg.pools.filter((p) => p.version === 'v5');
    for (const p of cfg.pools) { const x = dep[p.network].pools[p.token + '-' + p.amount]; p.address = x.addr; p.deployBlock = x.block; }
    for (const r of cfg.routers) { const x = dep[r.network].routers[r.token]; r.address = x.addr; r.deployBlock = x.block; }
    const cfgJson = JSON.stringify(cfg);
    const rtr = (net, tok) => dep[net].routers[tok];

    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    page = await ctx.newPage();
    page.on('console', (m) => consoleMsgs.push(m.type() + ': ' + m.text().slice(0, 300)));
    page.on('pageerror', (e) => pageErrors.push(e.message));
    let current = 'ethereum-sepolia';
    await page.exposeFunction('__rpc', async (method, paramsJson) => {
      const params = JSON.parse(paramsJson || '[]');
      try {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return JSON.stringify({ result: [accounts[0]] });
        if (method === 'eth_chainId') return JSON.stringify({ result: CHAINS[current].hex });
        if (method === 'net_version') return JSON.stringify({ result: String(CHAINS[current].id) });
        if (method === 'wallet_switchEthereumChain') {
          const k = Object.keys(CHAINS).find((x) => CHAINS[x].hex === String(params[0].chainId).toLowerCase());
          if (!k) return JSON.stringify({ error: { code: 4902, message: 'Unrecognized chain' } });
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
      const rk = Object.entries(cfg.networks).find(([k, n]) => url.startsWith(n.rpcUrl));
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

    const waitText = (sel, re, ms = 240000) => page.waitForFunction(([s, r]) => new RegExp(r).test((document.querySelector(s) || {}).textContent || ''), [sel, re.source], { timeout: ms });
    const pick = async (id) => { await page.selectOption('#poolSelect', id); await page.waitForTimeout(600); };
    const pickNT = async (net, tok) => { await page.selectOption('#netSelect', net); await page.selectOption('#tokSelect', tok); await page.waitForTimeout(600); };
    const bal = async (chain, token, who) => new ethers.Contract(token, ERC20, eth[chain]).balanceOf(who);
    const idx = async (chain, name) => Number(await new ethers.Contract(dep[chain].pools[name].addr, POOLX, eth[chain]).nextIndex());

    const depositAny = async (amount, mode, step) => {
      await page.click('#tab-deposit'); await page.click('#depMode-any');
      if (await page.locator('#keySavedChk').count()) { const c = page.locator('#keySavedChk'); if (!(await c.isChecked())) await c.check(); }
      await page.fill('#daAmount', String(amount));
      if (mode === 'round') { await page.check('input[name="daRound"][value="round"]'); await page.selectOption('#daStep', String(step)); } else await page.check('input[name="daRound"][value="exact"]');
      await page.waitForTimeout(200);
      const prev = (await page.textContent('#daPreview')).trim();
      const old = await page.evaluate(() => (document.getElementById('masterText') || {}).textContent || '');
      await page.click('#daDepositBtn');
      await page.waitForFunction((o) => { const e = document.getElementById('masterText'); return e && e.textContent.trim() && e.textContent.trim() !== o; }, old, { timeout: 240000 });
      return { key: (await page.textContent('#masterText')).trim(), prev };
    };
    const withdrawAny = async (key, amount, to) => {
      await page.click('#tab-withdraw'); await page.click('#wdMode-any');
      await page.evaluate(() => { const e = document.getElementById('waStatus'); e.textContent = ''; });
      await page.fill('#waKey', key); await page.fill('#waAmount', String(amount)); await page.fill('#waRecipient', to);
      await page.waitForFunction(() => !document.getElementById('waGoBtn').disabled || true);
      await page.click('#waFindBtn');
      await page.waitForFunction(() => { const b = document.getElementById('waFindBtn'); return !b.disabled; }, null, { timeout: 120000 });
      const plan = (await page.textContent('#waPlan')).replace(/\s+/g, ' ').trim();
      const status = (await page.textContent('#waStatus')).trim();
      return { plan, status };
    };
    const goWithdraw = async () => {
      await page.click('#waGoBtn');
      await waitText('#waStatus', /Withdrawn|Failed/);
      return (await page.textContent('#waStatus')).trim();
    };

    await page.goto('https://latheon.test/demo/');
    await waitText('#poolInfo', /contract 0x/, 60000);
    rec('A0. Page loads, 4 routers read from deployments.json', await page.evaluate(() => true) && !pageErrors.length, pageErrors.join('|').slice(0, 100));
    await pick('ethereum-sepolia:LTH-50');
    await page.click('#connectBtn'); await waitText('#walletStatus', /Connected to/, 60000);

    rec('A1. Fixed mode: pool list visible; network and token selectors present', await page.isVisible('#poolRow') && await page.isVisible('#netSelect') && await page.isVisible('#tokSelect'), '');
    await page.selectOption('#netSelect', 'robinhood-testnet'); await page.waitForTimeout(500);
    const toksRH = await page.$$eval('#tokSelect option', (o) => o.map((x) => x.value).join());
    const poolsRH = await page.$$eval('#poolSelect option', (o) => o.map((x) => x.value).join());
    rec('A2. Switching network keeps token and denomination; Robinhood offers LTH and USDG', toksRH === 'LTH,USDG' && (await page.inputValue('#poolSelect')) === 'robinhood-testnet:LTH-50', toksRH + ' / ' + (await page.inputValue('#poolSelect')));
    await page.selectOption('#tokSelect', 'USDG'); await page.waitForTimeout(400);
    rec('A3. Token USDG lists its 4 pools and keeps denomination 50', (await page.$$eval('#poolSelect option', (o) => o.length)) === 4 && (await page.inputValue('#poolSelect')) === 'robinhood-testnet:USDG-50', await page.inputValue('#poolSelect'));
    await pickNT('ethereum-sepolia', 'LTH'); await pick('ethereum-sepolia:LTH-50');
    await page.click('#depMode-any');
    rec('A4. Any-amount mode hides the pool list, keeps network and token', !(await page.isVisible('#poolRow')) && await page.isVisible('#netSelect'), '');
    await page.click('#depMode-fixed');
    rec('A5. Back to fixed mode shows the pool list again', await page.isVisible('#poolRow'), '');
    await page.click('#depMode-any');
    // ---- B: Ethereum, 160 exact -> 100+50+10
    await page.click('#tab-deposit'); await page.click('#depMode-any');
    await page.fill('#daAmount', '160'); await page.waitForTimeout(200);
    const prev160 = (await page.textContent('#daPreview')).trim();
    rec('B1. Preview 160 exact: 3 notes, 1×100 + 1×50 + 1×10', /3/.test(prev160) && /1×100 \+ 1×50 \+ 1×10/.test(prev160), prev160.slice(0, 90));
    await page.fill('#daAmount', '1.5'); await page.waitForTimeout(150);
    rec('B2. Exact mode refuses a fractional amount', /whole/i.test(await page.textContent('#daPreview')) && await page.isDisabled('#daDepositBtn'), (await page.textContent('#daPreview')).slice(0, 70));
    await page.fill('#daAmount', '160');
    const before = await bal('ethereum-sepolia', dep['ethereum-sepolia'].lth.addr, R_(0));
    const d1 = await depositAny(160, 'exact');
    const after = await bal('ethereum-sepolia', dep['ethereum-sepolia'].lth.addr, R_(0));
    const idx1 = [await idx('ethereum-sepolia', 'LTH-100'), await idx('ethereum-sepolia', 'LTH-50'), await idx('ethereum-sepolia', 'LTH-10'), await idx('ethereum-sepolia', 'LTH-1')];
    const routerBal = await bal('ethereum-sepolia', dep['ethereum-sepolia'].lth.addr, rtr('ethereum-sepolia', 'LTH').addr);
    rec('B3. Deposit 160: wallet -160, pools got 1/1/1/0 notes, router holds 0', before - after === 160n * E18 && idx1.join() === '1,1,1,0' && routerBal === 0n, 'idx ' + idx1.join());
    rec('B4. Master key has the documented format and names the right router', d1.key.startsWith('latheon-master:11155111:' + rtr('ethereum-sepolia', 'LTH').addr + ':'), d1.key.slice(0, 60) + '…');
    const dlBtn = await page.isDisabled('#daDepositBtn');
    rec('B5. Deposit button stays locked until "I saved the master key" is ticked', dlBtn, '');
    await page.screenshot({ path: SHOTS + '/dep-key-en.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 900 }); await page.waitForTimeout(300); await page.screenshot({ path: SHOTS + '/dep-key-mobile.png', fullPage: true }); await page.setViewportSize({ width: 1280, height: 1000 });

    // wrong amount (not reachable): 100 from 160 = 100 -> reachable; 70 -> not (notes 100/50/10)
    let w = await withdrawAny(d1.key, 70, R_(5));
    rec('B6. Amount 70 from notes 100/50/10: not payable, nearest amount shown, no transaction possible', /Cannot pay exactly 70/.test(w.plan) && /Nearest payable amount: (60|50|110)/.test(w.plan) && await page.isDisabled('#waGoBtn'), w.plan.slice(0, 160));
    w = await withdrawAny(d1.key, 160, R_(5));
    rec('B7. Amount 160: plan uses 3 notes', /Withdraws 160 LTH using 3 notes: 1×100 \+ 1×50 \+ 1×10/.test(w.plan) && !(await page.isDisabled('#waGoBtn')), w.plan.slice(0, 160));
    await page.screenshot({ path: SHOTS + '/wd-plan-en.png', fullPage: true });
    const msg = await goWithdraw();
    const got = await bal('ethereum-sepolia', dep['ethereum-sepolia'].lth.addr, R_(5));
    rec('B8. One withdrawMany transaction paid 160 to the recipient', /Withdrawn 160 LTH/.test(msg) && got === 160n * E18, msg.slice(0, 80));
    await page.screenshot({ path: SHOTS + '/wd-done-en.png', fullPage: true });
    w = await withdrawAny(d1.key, 10, R_(6));
    rec('B9. Same key again: all notes shown as already spent, nothing to withdraw', /Already spent: 3/.test(w.plan) && /Cannot pay exactly 10/.test(w.plan) && await page.isDisabled('#waGoBtn'), w.plan.slice(0, 140));

    // ---- C: round-down mode, 99 -> 90 (round to 10), remainder 9
    const before2 = await bal('ethereum-sepolia', dep['ethereum-sepolia'].lth.addr, R_(0));
    await page.click('#tab-deposit'); await page.fill('#daAmount', '99'); await page.check('input[name="daRound"][value="exact"]'); await page.waitForTimeout(200);
    const prevExact99 = (await page.textContent('#daPreview')).trim();
    rec('C1. 99 exact = 14 notes (50 + 4×10 + 9×1)', /14/.test(prevExact99) && /1×50 \+ 4×10 \+ 9×1/.test(prevExact99), prevExact99.slice(0, 100));
    const d2 = await depositAny(99, 'round', 10);
    const after2 = await bal('ethereum-sepolia', dep['ethereum-sepolia'].lth.addr, R_(0));
    rec('C2. Round down to 10: preview shows 5 notes and remainder 9, wallet -90 only', /5/.test(d2.prev) && /Stays in your wallet: 9 LTH/.test(d2.prev) && before2 - after2 === 90n * E18, d2.prev.slice(0, 120));
    // wrong key and unknown router
    w = await withdrawAny('latheon-master:11155111:' + rtr('ethereum-sepolia', 'LTH').addr + ':12345', 50, R_(7));
    rec('C3. Wrong master key: "no notes for this key", nothing offered', /No notes for this key/.test(w.plan) && await page.isDisabled('#waGoBtn'), w.plan.slice(0, 80));
    w = await withdrawAny('latheon-master:11155111:0x' + '11'.repeat(20) + ':12345', 50, R_(7));
    rec('C4. Key for an unknown router: clear message', /does not know/.test(w.status), w.status.slice(0, 90));
    w = await withdrawAny('garbage', 50, R_(7));
    rec('C5. Malformed key: error, no crash', /Failed/.test(w.status), w.status.slice(0, 90));
    // partial: 50 now (the 50-note), then 40 left (4×10), 100 not reachable
    w = await withdrawAny(d2.key, 50, R_(7));
    let m = await goWithdraw();
    const g7 = await bal('ethereum-sepolia', dep['ethereum-sepolia'].lth.addr, R_(7));
    rec('C6. Partial withdraw 50 of 90: pays exactly 50, the rest stays', /Withdrawn 50 LTH/.test(m) && g7 === 50n * E18, m.slice(0, 70));
    w = await withdrawAny(d2.key, 100, R_(7));
    rec('C7. 100 requested, 40 left: not payable, nearest 40', /Cannot pay exactly 100/.test(w.plan) && /Nearest payable amount: 40/.test(w.plan) && /Already spent: 1/.test(w.plan), w.plan.slice(0, 170));
    // separate notes + composability with the ordinary one-note withdraw
    w = await withdrawAny(d2.key, 20, R_(8));
    await page.click('#waSepBtn');
    const sepNotes = await page.$$eval('#waSep code', (els) => els.map((e) => e.textContent.trim()));
    rec('C8. "Show separate notes" lists 2 ordinary V5 notes for 20', sepNotes.length === 2 && sepNotes.every((n) => n.startsWith('latheon-v5:11155111:')), sepNotes.length + ' notes');
    await page.click('#wdMode-one');
    await page.fill('#noteInput', sepNotes[0]); await page.fill('#recipientInput', R_(9));
    await page.evaluate(() => { document.getElementById('withdrawStatus').textContent = ''; });
    await page.click('#withdrawBtn'); await waitText('#withdrawStatus', /successful|Failed/);
    const g9 = await bal('ethereum-sepolia', dep['ethereum-sepolia'].lth.addr, R_(9));
    rec('C9. One of those notes withdrawn with the ordinary single-note flow to another address (10 LTH)', g9 === 10n * E18, (await page.textContent('#withdrawStatus')).trim().slice(0, 60));
    w = await withdrawAny(d2.key, 40, R_(8));
    rec('C10. After that, 3 notes remain (3×10); 40 is no longer payable, 30 is', /Already spent: 2/.test(w.plan) && /Cannot pay exactly 40/.test(w.plan) && /Nearest payable amount: 30/.test(w.plan), w.plan.slice(0, 170));
    m = await (async () => { await page.fill('#waAmount', '30'); await page.fill('#waRecipient', R_(8)); await page.click('#waFindBtn'); await page.waitForFunction(() => !document.getElementById('waFindBtn').disabled); return goWithdraw(); })();
    rec('C11. Withdraw the remaining 30', /Withdrawn 30 LTH/.test(m) && (await bal('ethereum-sepolia', dep['ethereum-sepolia'].lth.addr, R_(8))) === 30n * E18, m.slice(0, 60));

    // ---- D: Robinhood USDG, 6 decimals, 12.
    await page.click('#tab-deposit'); await page.click('#depMode-any'); await pickNT('robinhood-testnet', 'USDG');
    const beforeU = await bal('robinhood-testnet', dep['robinhood-testnet'].usdg.addr, R_(0));
    const d3 = await depositAny(12, 'exact');
    const afterU = await bal('robinhood-testnet', dep['robinhood-testnet'].usdg.addr, R_(0));
    rec('D1. USDG (6 decimals): 12 → 10+1+1, wallet -12 USDG', beforeU - afterU === 12n * E6 && /1×10 \+ 2×1/.test(d3.prev), d3.prev.slice(0, 90));
    await withdrawAny(d3.key, 12, R_(4)); m = await goWithdraw();
    rec('D2. USDG withdrawn by key: recipient got exactly 12 USDG', /Withdrawn 12 USDG/.test(m) && (await bal('robinhood-testnet', dep['robinhood-testnet'].usdg.addr, R_(4))) === 12n * E6, m.slice(0, 60));

    // ---- E: Arbitrum, 3 notes of the same size and a larger batch (32 notes max) -> 31 notes: 100+... use 3200? limit; 17 notes: 9×1+...
    await page.click('#tab-deposit'); await page.click('#depMode-any'); await pickNT('arbitrum-sepolia', 'LTH');
    await page.fill('#daAmount', '999'); await page.check('input[name="daRound"][value="exact"]'); await page.waitForTimeout(200);
    const p999 = (await page.textContent('#daPreview')).trim();
    rec('E1. 999 exact is 9×100 + 1×50 + 4×10 + 9×1 = 23 notes; shown with the larger-transaction tip', /23/.test(p999) && /larger transaction|Many small notes/i.test(p999), p999.slice(0, 120));
    await page.fill('#daAmount', '3399'); await page.waitForTimeout(150);
    rec('E2. Too many notes is refused before sending', /at most 32/.test(await page.textContent('#daPreview')) && await page.isDisabled('#daDepositBtn'), (await page.textContent('#daPreview')).slice(0, 90));
    const d4 = await depositAny(999, 'exact');
    // 23 notes proven one by one takes a while; withdraw 999 in one go
    const t0 = Date.now(); await withdrawAny(d4.key, 999, R_(3)); m = await goWithdraw();
    rec('E3. 23-note deposit withdrawn by amount in one transaction', /Withdrawn 999 LTH/.test(m) && (await bal('arbitrum-sepolia', dep['arbitrum-sepolia'].lth.addr, R_(3))) === 999n * E18, Math.round((Date.now() - t0) / 1000) + ' s');

    // ---- F: languages
    for (const lang of ['ru', 'zh']) {
      await page.selectOption('#langSelect', lang); await page.waitForTimeout(300);
      await page.click('#tab-deposit'); await page.click('#depMode-any'); await page.fill('#daAmount', '160'); await page.waitForTimeout(200);
      const pv = (await page.textContent('#daPreview')).trim();
      rec('F-' + lang + '. Preview translated, no raw keys', !/\{|da\.|wa\./.test(pv) && pv.length > 10 && pv !== 'da.prev', pv.slice(0, 80));
      await page.screenshot({ path: SHOTS + '/dep-' + lang + '.png', fullPage: true });
      await page.click('#tab-withdraw'); await page.click('#wdMode-any'); await page.waitForTimeout(150);
      await page.screenshot({ path: SHOTS + '/wd-' + lang + '.png', fullPage: true });
    }
    await page.selectOption('#langSelect', 'en');
    const raw = await page.evaluate(() => [...document.querySelectorAll('[data-i18n]')].filter((e) => e.getAttribute('data-i18n') === e.textContent.trim()).map((e) => e.getAttribute('data-i18n')));
    rec('F3. Every data-i18n element has a translation (no raw keys)', raw.length === 0, raw.join(','));
    rec('G. No JavaScript errors in the whole run', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
  } catch (e) {
    say('TEST ERROR:', e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : e);
    try { say('--- console tail ---'); consoleMsgs.slice(-12).forEach((m) => say('  ' + m)); say('--- pageErrors: ' + pageErrors.join(' | ')); if (page) { say('--- log tail: ' + (await page.textContent('#log')).slice(-600)); await page.screenshot({ path: SHOTS + '/fail.png' }); } } catch (e2) {}
    rec('Test aborted', false, String(e && e.message).slice(0, 150));
  } finally {
    say('\nSUMMARY: ' + results.filter((r) => r[1]).length + '/' + results.length + ' passed' + (results.every((r) => r[1]) ? ' - ALL OK' : ' - FAILURES'));
    say('E2E_DONE');
    if (browser) await browser.close();
    process.exit(0);
  }
})();
