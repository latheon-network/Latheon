// REFERENCE ONLY. End-to-end browser test used to verify demo/index.html (16 checks, all passed on 2026-10-04).
// Paths are hard-coded for the sandbox it was written in; adapt them before reuse. See README.md in this folder.
const fs = require('fs');
const path = require('path');
const solc = require('solc');
const ganache = require('ganache');
const { ethers } = require('ethers');
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');

const R = '/home/claude/latheon-count';
const DEMO = '/mnt/user-data/outputs/v5-release/demo';
const rd = (p) => fs.readFileSync(p, 'utf8');
const say = (...a) => console.log(...a);

// ---------------------------------------------------------------- compile
const sources = {
  'contracts/LatheonShieldedPoolV5.sol': { content: rd(R + '/contracts/LatheonShieldedPoolV5.sol') },
  'contracts/LatheonShieldedPoolV4.sol': { content: rd(R + '/contracts/LatheonShieldedPoolV4.sol') },
  'contracts/PoseidonT3.sol': { content: rd(R + '/contracts/PoseidonT3.sol') },
  'contracts/LatheonToken.sol': { content: rd(R + '/contracts/LatheonToken.sol') },
  'contracts/LatheonFaucet.sol': { content: rd(R + '/contracts/LatheonFaucet.sol') },
  'contracts/VerifierV5.sol': { content: rd('/home/claude/flex-test/v3/WithdrawVerifierV3.sol') },
  'contracts/VerifierV2.sol': { content: rd('/home/claude/eth-verifier/EthWithdrawVerifier.sol') },
  'contracts/VerifierDisclose.sol': { content: rd('/home/claude/disclose-verifier/DiscloseVerifier.sol') },
  'contracts/TestToken6.sol': { content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
contract TestToken6 is ERC20 {
    constructor() ERC20("Test6", "T6") { _mint(msg.sender, 1_000_000 * 10 ** 6); }
    function decimals() public pure override returns (uint8) { return 6; }
}` },
};
const imp = (p) => { const f = path.join(__dirname, 'node_modules', p); return fs.existsSync(f) ? { contents: rd(f) } : { error: 'nf ' + p }; };
say('Компилирую…');
const out = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.bytecode.linkReferences'] } } } }), { import: imp }));
if ((out.errors || []).some((e) => e.severity === 'error')) { say(out.errors.filter((e) => e.severity === 'error').map((e) => e.formattedMessage).join('\n')); process.exit(1); }
const K = (f, n) => out.contracts['contracts/' + f][n];
const C = { Pool5: K('LatheonShieldedPoolV5.sol', 'LatheonShieldedPoolV5'), Pool4: K('LatheonShieldedPoolV4.sol', 'LatheonShieldedPoolV4'), Poseidon: K('PoseidonT3.sol', 'PoseidonT3'),
  Token: K('LatheonToken.sol', 'LatheonToken'), Faucet: K('LatheonFaucet.sol', 'LatheonFaucet'), Ver5: K('VerifierV5.sol', 'Groth16Verifier'),
  Ver2: K('VerifierV2.sol', 'Groth16Verifier'), VerD: K('VerifierDisclose.sol', 'Groth16Verifier'), T6: K('TestToken6.sol', 'TestToken6') };
const linked = (c, libs) => { let code = c.evm.bytecode.object; const refs = c.evm.bytecode.linkReferences; for (const f in refs) for (const l in refs[f]) for (const { start, length } of refs[f][l]) code = code.slice(0, start * 2) + libs[l].slice(2).toLowerCase() + code.slice(start * 2 + length * 2); return code; };

// ---------------------------------------------------------------- chains
const CHAINS = { 'ethereum-sepolia': { id: 11155111, hex: '0xaa36a7' }, 'arbitrum-sepolia': { id: 421614, hex: '0x66eee' }, 'robinhood-testnet': { id: 46630, hex: '0xb626' } };
const E18 = 10n ** 18n, E6 = 10n ** 6n;
const ERC20 = ['function balanceOf(address) view returns (uint256)'];

(async () => {
  const results = []; const rec = (n, ok, note) => { results.push([n, ok]); say((ok ? '✅ ' : '❌ ') + n + (note ? '   [' + note + ']' : '')); };
  let browser, page; const consoleMsgs = [];
  try {
    const providers = {}, eth = {}, dep = {};
    for (const [k, c] of Object.entries(CHAINS)) {
      providers[k] = ganache.provider({ logging: { quiet: true }, chain: { chainId: c.id, networkId: c.id, hardfork: 'shanghai' }, wallet: { deterministic: true }, miner: { blockGasLimit: 60000000 } });
      eth[k] = new ethers.BrowserProvider(providers[k]);
    }
    const accounts = (await providers['ethereum-sepolia'].request({ method: 'eth_accounts', params: [] }));
    const R_ = (i) => ethers.getAddress(accounts[i]);

    // identical deployment sequence on every chain -> identical addresses across chains (as in real life)
    say('Разворачиваю стеки на трёх локальных сетях…');
    for (const k of Object.keys(CHAINS)) {
      const s = await eth[k].getSigner(0), me = await s.getAddress();
      const d = async (c, args = [], libs = {}) => { const f = new ethers.ContractFactory(c.abi, '0x' + linked(c, libs), s); const x = await f.deploy(...args); const rc = await x.deploymentTransaction().wait(); return { c: x, addr: await x.getAddress(), block: rc.blockNumber }; };
      const lib = await d(C.Poseidon), libs = { PoseidonT3: lib.addr };
      const ver5 = await d(C.Ver5), verD = await d(C.VerD), lth = await d(C.Token, [me]), faucet = await d(C.Faucet, [lth.addr]);
      await (await lth.c.transfer(faucet.addr, 100000n * E18)).wait();
      const pools = {};
      for (const a of [100, 50, 10, 1]) pools['LTH-' + a] = await d(C.Pool5, [lth.addr, ver5.addr, BigInt(a) * E18], libs);
      dep[k] = { lib, ver5, verD, lth, faucet, pools };
      if (k === 'robinhood-testnet') {
        dep[k].t6 = await d(C.T6);
        for (const a of [100, 50, 10, 1]) pools['USDG-' + a] = await d(C.Pool5, [dep[k].t6.addr, ver5.addr, BigInt(a) * E6], libs);
      }
      if (k === 'ethereum-sepolia') {
        dep[k].ver2 = await d(C.Ver2);
        dep[k].legacy = await d(C.Pool4, [lth.addr, dep[k].ver2.addr], libs);
      }
      say('  ' + k + ': ' + Object.keys(pools).length + ' пулов V5' + (dep[k].legacy ? ' + 1 legacy V4' : ''));
    }
    const sameAddr = dep['ethereum-sepolia'].pools['LTH-50'].addr === dep['arbitrum-sepolia'].pools['LTH-50'].addr;
    rec('Подготовка: пул LTH-50 имеет ОДИНАКОВЫЙ адрес на Ethereum и Arbitrum (воспроизводим коллизию из жизни)', sameAddr, dep['ethereum-sepolia'].pools['LTH-50'].addr);

    // ---- test deployments.json built from the real one
    const cfg = JSON.parse(rd(DEMO + '/deployments.json'));
    for (const [k, n] of Object.entries(cfg.networks)) {
      n.v5Verifier = dep[k].ver5.addr; n.discloseVerifier = dep[k].verD.addr;
      n.tokens.LTH.address = dep[k].lth.addr; n.tokens.LTH.faucet = dep[k].faucet.addr;
      if (n.tokens.USDG) n.tokens.USDG.address = dep[k].t6.addr;
    }
    cfg.pools = cfg.pools.filter((p) => p.version === 'v5' || p.id === 'ethereum-sepolia:legacy-eth-lth');
    for (const p of cfg.pools) {
      if (p.version === 'v5') { const x = dep[p.network].pools[p.token + '-' + p.amount]; p.address = x.addr; p.deployBlock = x.block; }
      else { const L = dep['ethereum-sepolia']; p.address = L.legacy.addr; p.verifier = L.ver2.addr; p.startBlock = L.legacy.block; }
    }
    const cfgJson = JSON.stringify(cfg);

    // ---- browser with a mock wallet
    browser = await chromium.launch();
    const ctx = await browser.newContext();
    page = await ctx.newPage();
    page.on('console', (m) => consoleMsgs.push(m.type() + ': ' + m.text().slice(0, 300)));
    page.on('requestfailed', (r) => consoleMsgs.push('REQFAIL ' + r.url().slice(0, 120) + ' ' + (r.failure() || {}).errorText));
    const pageErrors = [];
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
    await page.addInitScript(() => {
      window.ethereum = {
        isMetaMask: true,
        request: async ({ method, params }) => {
          const r = JSON.parse(await window.__rpc(method, JSON.stringify(params || [])));
          if (r.error) { const e = new Error(r.error.message); e.code = r.error.code; throw e; }
          return r.result;
        },
        on() {}, removeListener() {},
      };
    });
    const FILES = {
      'https://cdn.jsdelivr.net/gh/latheon-network/latheon@main/circuits/build/withdraw_v3/withdraw_v3.wasm': '/home/claude/flex-test/v3/withdraw_v3_js/withdraw_v3.wasm',
      'https://cdn.jsdelivr.net/gh/latheon-network/latheon@main/circuits/build/withdraw_v3/withdraw_v3_final.zkey': '/home/claude/flex-test/v3/withdraw_v3_final.zkey',
      'https://cdn.jsdelivr.net/gh/latheon-network/latheon@main/circuits/build/withdraw_v2/withdraw_v2.wasm': R + '/circuits/build/withdraw_v2/withdraw_v2.wasm',
      'https://cdn.jsdelivr.net/gh/latheon-network/latheon@main/circuits/build/withdraw_v2/withdraw_v2_final.zkey': R + '/circuits/build/withdraw_v2/withdraw_v2_final.zkey',
      'https://cdn.jsdelivr.net/gh/latheon-network/latheon@main/circuits/build/disclose/disclose.wasm': '/home/claude/disclose-verifier/build/disclose.wasm',
      'https://cdn.jsdelivr.net/gh/latheon-network/latheon@main/circuits/build/disclose/disclose_final.zkey': '/home/claude/disclose-verifier/disclose_final_zkey.zkey',
    };
    const BUNDLES = { 'https://esm.run/ethers': 'ethers', 'https://esm.run/poseidon-lite': 'poseidon', 'https://esm.run/snarkjs': 'snarkjs' };
    const cors = { 'access-control-allow-origin': '*' };
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (url === 'https://latheon.test/demo/') return route.fulfill({ status: 200, contentType: 'text/html', body: rd(DEMO + '/index.html') });
      if (url === 'https://latheon.test/demo/deployments.json') return route.fulfill({ status: 200, contentType: 'application/json', body: cfgJson });
      if (BUNDLES[url]) return route.fulfill({ status: 200, contentType: 'application/javascript', headers: cors, body: rd(__dirname + '/bundles/' + BUNDLES[url] + '.mjs') });
      if (FILES[url]) return route.fulfill({ status: 200, contentType: 'application/octet-stream', headers: cors, body: fs.readFileSync(FILES[url]) });
      return route.abort();
    });

    const waitText = (sel, re, ms = 240000) => page.waitForFunction(([s, r]) => new RegExp(r).test((document.querySelector(s) || {}).textContent || ''), [sel, re.source], { timeout: ms });
    const pick = async (id) => { await page.selectOption('#poolSelect', id); await page.waitForTimeout(700); };
    const deposit = async () => { await page.evaluate(() => { document.getElementById('depositResult').innerHTML = ''; }); await page.click('#depositBtn'); await page.waitForSelector('#noteText', { timeout: 240000 }); return (await page.textContent('#noteText')).trim(); };
    const withdraw = async (note, to) => {
      await page.evaluate(() => { const e = document.getElementById('withdrawStatus'); e.textContent = ''; });
      await page.fill('#noteInput', note); await page.fill('#recipientInput', to); await page.click('#withdrawBtn');
      await waitText('#withdrawStatus', /Withdrawal successful|Failed/);
      return (await page.textContent('#withdrawStatus')).trim();
    };
    const bal = async (chain, token, who) => new ethers.Contract(token, ERC20, eth[chain]).balanceOf(who);

    await page.goto('https://latheon.test/demo/');
    await waitText('#poolInfo', /contract 0x/, 60000);
    const nOpts = await page.locator('#poolSelect option').count();
    rec('T0. Страница загрузилась, deployments.json прочитан: 16 пулов V5 + 1 legacy в списке', nOpts === 17, 'опций: ' + nOpts);
    rec('T0b. Самопроверка Poseidon прошла в браузере', (await page.textContent('#log')).includes('Poseidon self-check passed'), '');

    // ---- T1: Ethereum, 50 LTH, faucet + deposit + withdraw
    await pick('ethereum-sepolia:LTH-50');
    await page.click('#connectBtn'); await waitText('#walletStatus', /Connected to/, 60000);
    await page.click('#claimBtn'); await waitText('#faucetStatus', /Claimed|failed/i, 60000);
    rec('T1a. Фаусет LTH: claim() прошёл', /Claimed/.test(await page.textContent('#faucetStatus')), '');
    let note = await deposit();
    rec('T1b. Депозит 50 LTH: нота нового формата с chainId и адресом пула', note.startsWith('latheon-v5:11155111:' + dep['ethereum-sepolia'].pools['LTH-50'].addr + ':'), note.slice(0, 70) + '…');
    let msg = await withdraw(note, R_(5));
    let got = await bal('ethereum-sepolia', dep['ethereum-sepolia'].lth.addr, R_(5));
    rec('T1c. Вывод 50 LTH на Ethereum: получатель получил ровно 50', /successful/.test(msg) && got === 50n * E18, msg.slice(0, 60));

    // ---- T2: SAME address on Arbitrum (cache must be per chain)
    await pick('arbitrum-sepolia:LTH-50');
    note = await deposit();
    msg = await withdraw(note, R_(6));
    got = await bal('arbitrum-sepolia', dep['arbitrum-sepolia'].lth.addr, R_(6));
    rec('T2. Тот же адрес пула на Arbitrum: вывод работает (кеш не путает сети)', /successful/.test(msg) && got === 50n * E18, msg.slice(0, 80));
    const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.endsWith(':deposits')));
    rec('T2b. В кеше раздельные ключи для двух сетей с одним адресом', keys.length >= 2 && keys.some((k) => k.includes(':11155111:') || k.includes('v5-11155111:')) && keys.some((k) => k.includes('421614:')), keys.map((k) => k.replace('latheon-cache-v5-', '')).join(' | ').slice(0, 120));

    // ---- T3: Robinhood USDG (6 decimals)
    await pick('robinhood-testnet:USDG-10');
    note = await deposit();
    msg = await withdraw(note, R_(7));
    got = await bal('robinhood-testnet', dep['robinhood-testnet'].t6.addr, R_(7));
    rec('T3. Robinhood, 10 USDG (6 знаков): вывод, получатель получил ровно 10 USDG', /successful/.test(msg) && got === 10n * E6, msg.slice(0, 60));

    // ---- T4: a note from Ethereum pasted while the UI is on another network
    await pick('ethereum-sepolia:LTH-10');
    const note4 = await deposit();
    await pick('robinhood-testnet:USDG-1');
    msg = await withdraw(note4, R_(8));
    got = await bal('ethereum-sepolia', dep['ethereum-sepolia'].lth.addr, R_(8));
    const selNow = await page.inputValue('#poolSelect');
    rec('T4. Нота с Ethereum вставлена при выбранном Robinhood: приложение само выбрало нужный пул и сеть, вывод прошёл', /successful/.test(msg) && got === 10n * E18 && selNow === 'ethereum-sepolia:LTH-10', 'выбран: ' + selNow);

    // ---- T5: spending the same note again
    msg = await withdraw(note4, R_(9));
    const none = await bal('ethereum-sepolia', dep['ethereum-sepolia'].lth.addr, R_(9));
    rec('T5. Повторный вывод той же ноты: отклонён понятным сообщением до отправки, баланс не изменился', /already been withdrawn/.test(msg) && none === 0n, msg.slice(0, 70));

    // ---- T6: disclosure
    await page.fill('#discloseNoteInput', note4); await page.fill('#auditorNonceInput', '424242');
    await page.evaluate(() => { document.getElementById('discloseStatus').textContent = ''; });
    await page.click('#discloseBtn'); await waitText('#discloseStatus', /verified|Failed|did not verify/);
    const dtxt = (await page.textContent('#discloseStatus')).trim();
    const block = await page.inputValue('#discloseBlock').catch(() => '');
    let parsed = null; try { parsed = JSON.parse(block); } catch (e) {}
    rec('T6. Раскрытие аудитору: доказательство проверено ончейн, блок для аудитора содержит порядок сигналов', /verified/.test(dtxt) && parsed && parsed.pubSignalsOrder && parsed.pubSignalsOrder[0] === 'commitment' && BigInt(parsed.pubSignals[2]) === 424242n, dtxt.slice(0, 60));

    // ---- T7: legacy V4 pool
    await pick('ethereum-sepolia:legacy-eth-lth');
    const banner = await page.isVisible('#legacyBanner');
    note = await deposit();
    msg = await withdraw(note, R_(1));
    got = await bal('ethereum-sepolia', dep['ethereum-sepolia'].lth.addr, R_(1));
    rec('T7. Legacy V4: показан красный баннер, нота старого формата, вывод работает', banner && note.startsWith('latheon-v4-note:') && /successful/.test(msg) && got === 100n * E18, note.slice(0, 20));

    // ---- T8: garbage note
    msg = await withdraw('hello:world', R_(2));
    rec('T8. Мусор вместо ноты: понятная ошибка', /Unrecognised note format/.test(msg), msg.slice(0, 60));

    // ---- T9: a V4-format note while a V5 pool is selected
    await pick('arbitrum-sepolia:LTH-1');
    msg = await withdraw('latheon-v4-note:123:456', R_(3));
    rec('T9. Старая нота при выбранном V5-пуле: понятная ошибка, ничего не отправлено', /old-format note/.test(msg), msg.slice(0, 70));

    rec('T10. В браузере не было необработанных JS-ошибок', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
    await page.screenshot({ path: '/home/claude/e2e-final.png', fullPage: false });
  } catch (e) {
    say('ОШИБКА ТЕСТА:', e && e.message ? e.message : e);
    try {
      say('--- консоль браузера (последние 15) ---'); consoleMsgs.slice(-15).forEach((m) => say('  ' + m));
      if (page) { say('--- #poolInfo: ' + (await page.textContent('#poolInfo')).slice(0, 200)); say('--- #log (хвост): ' + (await page.textContent('#log')).slice(-500)); await page.screenshot({ path: '/home/claude/e2e-fail.png' }); }
    } catch (e2) { say('(диагностика недоступна: ' + e2.message + ')'); }
    rec('Тест прервался', false, String(e && e.message).slice(0, 150));
  } finally {
    say('\nИТОГ: ' + (results.length && results.every((r) => r[1]) ? 'ВСЕ ' + results.length + ' ПРОВЕРОК ПРОЙДЕНЫ' : 'ЕСТЬ ПРОВАЛЫ (' + results.filter((r) => !r[1]).length + ' из ' + results.length + ')'));
    say('E2E_DONE');
    if (browser) await browser.close();
    process.exit(0);
  }
})();
