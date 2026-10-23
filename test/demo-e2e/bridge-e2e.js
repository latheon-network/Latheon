// Browser end-to-end test for the bridge page (bridge/index.html). Two local chains on ganache: a parent with the real
// LatheonToken and stand-ins for the Orbit inbox, rollup and outbox, and a child (the Latheon chain id) with stand-ins for
// ArbSys and NodeInterface placed at their fixed addresses (fixtures/BridgeMocks.sol). The test plays the chain's part:
// it credits deposits on the child and confirms withdrawals on the parent. Mock wallet as in the demo tests.
//   BRIDGE=/path/to/folder/with/index.html node bridge-e2e.js
const fs = require('fs'), path = require('path');
const NM = path.resolve(__dirname, '..', 'distribution', 'node_modules');
const req = (m) => require(path.join(NM, m));
const solc = req('solc'), ganache = req('ganache'), { ethers } = req('ethers');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || '/usr/lib/node_modules/playwright')); }
const REPO = path.resolve(__dirname, '..', '..');
const BRIDGE = process.env.BRIDGE || path.join(REPO, 'bridge');
const SHOTS = process.env.SHOTS || path.join(require('os').tmpdir(), 'latheon-bridge-shots'); fs.mkdirSync(SHOTS, { recursive: true });
const rd = (p) => fs.readFileSync(p, 'utf8');
const say = (...a) => console.log(...a);

const sources = { 'Token.sol': { content: rd(REPO + '/contracts/LatheonToken.sol') }, 'BridgeMocks.sol': { content: rd(__dirname + '/fixtures/BridgeMocks.sol') } };
const imp = (p) => { const f = path.join(NM, p); return fs.existsSync(f) ? { contents: rd(f) } : { error: 'nf ' + p }; };
say('Compiling…');
const out = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris',
  outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } } }), { import: imp }));
if ((out.errors || []).some((e) => e.severity === 'error')) { say(out.errors.filter((e) => e.severity === 'error').map((e) => e.formattedMessage).join('\n')); process.exit(1); }
const K = (f, n) => out.contracts[f][n];
const C = { Token: K('Token.sol', 'LatheonToken'), Inbox: K('BridgeMocks.sol', 'MockERC20Inbox'), Rollup: K('BridgeMocks.sol', 'MockRollup'),
  Outbox: K('BridgeMocks.sol', 'MockOutbox'), ArbSys: K('BridgeMocks.sol', 'MockArbSys'), Node: K('BridgeMocks.sol', 'MockNodeInterface') };

const CHAINS = { parent: { id: 421614, hex: '0x66eee' }, child: { id: 60531373273, hex: '0xe17f374d9' } };
const URL = { parentRpc: 'https://rpc.parent.test', childRpc: 'https://rpc.child.test', parentExp: 'https://explorer.parent.test', childExp: 'https://explorer.child.test' };
const E18 = 10n ** 18n;
const ARBSYS = '0x0000000000000000000000000000000000000064', NODE = '0x00000000000000000000000000000000000000C8';

(async () => {
  const results = []; const rec = (n, ok, note) => { results.push([n, ok]); say((ok ? 'PASS ' : 'FAIL ') + n + (note ? '   [' + note + ']' : '')); };
  let browser; const consoleMsgs = [], pageErrors = [];
  try {
    const prov = {}, eth = {};
    for (const [k, c] of Object.entries(CHAINS)) {
      prov[k] = ganache.provider({ logging: { quiet: true }, chain: { chainId: c.id, networkId: c.id, hardfork: 'shanghai' }, wallet: { deterministic: true, defaultBalance: 1000 }, miner: { blockGasLimit: 30000000 } });
      eth[k] = new ethers.BrowserProvider(prov[k]);
    }
    const accounts = await prov.parent.request({ method: 'eth_accounts', params: [] });
    const user = ethers.getAddress(accounts[0]);
    const op = await eth.parent.getSigner(1);           // plays the chain operator / bridge on the parent
    const d = async (c, args, s) => { const f = new ethers.ContractFactory(c.abi, '0x' + c.evm.bytecode.object, s); const x = await f.deploy(...args); await x.deploymentTransaction().wait(); return x; };
    const token = await d(C.Token, [await op.getAddress()], op);
    const inbox = await d(C.Inbox, [await token.getAddress()], op);
    const outbox = await d(C.Outbox, [await token.getAddress()], op);
    const rollup = await d(C.Rollup, [await outbox.getAddress()], op);
    await (await token.transfer(user, 1000n * E18)).wait();
    await (await token.transfer(await outbox.getAddress(), 5000n * E18)).wait();   // what the real bridge holds for withdrawals
    await prov.child.request({ method: 'evm_setAccountCode', params: [ARBSYS, '0x' + C.ArbSys.evm.deployedBytecode.object] });
    await prov.child.request({ method: 'evm_setAccountCode', params: [NODE, '0x' + C.Node.evm.deployedBytecode.object] });
    // the user starts with 5 LTH on the child (enough for gas, as after a faucet claim)
    await prov.child.request({ method: 'evm_setAccountBalance', params: [user, ethers.toQuantity(5n * E18)] });
    say('  parent: token, inbox, outbox, rollup; child: ArbSys and NodeInterface code placed');

    const cfg = { schema: 1, networks: {
      'latheon-testnet': { name: 'Latheon Testnet', chainId: CHAINS.child.id, chainIdHex: CHAINS.child.hex, rpcUrl: URL.childRpc, explorerUrl: URL.childExp,
        nativeCurrency: { name: 'LTH (test)', symbol: 'LTH', decimals: 18 },
        bridge: { parentName: 'Arbitrum Sepolia', parentChainId: CHAINS.parent.id, parentRpcUrl: URL.parentRpc, parentExplorerUrl: URL.parentExp,
          token: await token.getAddress(), inbox: await inbox.getAddress(), rollup: await rollup.getAddress(), bridge: await inbox.getAddress(), pollMs: 700 } },
      'ethereum-sepolia': { name: 'Ethereum Sepolia', chainId: 11155111, chainIdHex: '0xaa36a7', rpcUrl: 'https://rpc.eth.test', explorerUrl: 'https://explorer.eth.test' },
    }, pools: [], routers: [] };

    // the chain's part: deposits seen on the parent inbox are credited on the child after a short delay
    let creditedBlock = 0;
    const credited = [];
    const depositTimer = setInterval(async () => {
      try {
        const logs = await inbox.queryFilter(inbox.filters.Deposited(), creditedBlock + 1);
        for (const l of logs) {
          creditedBlock = Math.max(creditedBlock, l.blockNumber);
          const who = l.args.from, amt = l.args.amount;
          const bal = BigInt(await prov.child.request({ method: 'eth_getBalance', params: [who, 'latest'] }));
          await prov.child.request({ method: 'evm_setAccountBalance', params: [who, ethers.toQuantity(bal + amt)] });
          credited.push([who, amt]);
        }
      } catch (e) { /* retry next tick */ }
    }, 1500);
    const sendCounts = new Map();   // child block hash -> sendCount, as Nitro adds to its block JSON

    browser = await chromium.launch();
    const mkPage = async (ctx) => {
      const page = await ctx.newPage();
      page.on('console', (m) => { if (m.type() === 'error') consoleMsgs.push(m.text().slice(0, 300)); });
      page.on('pageerror', (e) => pageErrors.push(e.message));
      return page;
    };
    let current = 'ethereum-sepolia';
    const known = new Set(['parent']); const added = [];
    const ctxs = [];
    const newCtx = async () => {
      const ctx = await browser.newContext({ viewport: { width: 1200, height: 1100 } });
      await ctx.exposeFunction('__rpc', async (method, paramsJson) => {
        const params = JSON.parse(paramsJson || '[]');
        try {
          if (method === 'eth_requestAccounts' || method === 'eth_accounts') return JSON.stringify({ result: [accounts[0]] });
          if (method === 'eth_chainId') return JSON.stringify({ result: current === 'ethereum-sepolia' ? '0xaa36a7' : CHAINS[current].hex });
          if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') {
            const k = Object.keys(CHAINS).find((x) => CHAINS[x].hex === String(params[0].chainId).toLowerCase());
            if (method === 'wallet_addEthereumChain') { added.push(params[0]); if (k) known.add(k); }
            if (!k || !known.has(k)) return JSON.stringify({ error: { code: 4902, message: 'Unrecognized chain ID' } });
            current = k; return JSON.stringify({ result: null });
          }
          if (current === 'ethereum-sepolia') return JSON.stringify({ error: { code: -32000, message: 'wallet on a chain this test does not run' } });
          return JSON.stringify({ result: await prov[current].request({ method, params }) });
        } catch (e) { return JSON.stringify({ error: { code: e.code || -32000, message: e.message || String(e) } }); }
      });
      await ctx.addInitScript(() => { window.ethereum = { isMetaMask: true, request: async ({ method, params }) => { const r = JSON.parse(await window.__rpc(method, JSON.stringify(params || []))); if (r.error) { const e = new Error(r.error.message); e.code = r.error.code; throw e; } return r.result; }, on() {}, removeListener() {} }; });
      await ctx.route('**/*', async (route) => {
        const url = route.request().url();
        if (url === 'https://latheon.test/bridge/') return route.fulfill({ status: 200, contentType: 'text/html', body: rd(BRIDGE + '/index.html') });
        if (url.startsWith('https://latheon.test/demo/deployments.json')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cfg) });
        if (url === 'https://esm.run/ethers') return route.fulfill({ status: 200, contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' }, body: rd(__dirname + '/bundles/ethers.mjs') });
        const k = url.startsWith(URL.parentRpc) ? 'parent' : url.startsWith(URL.childRpc) ? 'child' : null;
        if (k) {
          const h = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
          if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: h });
          const body = JSON.parse(route.request().postData() || '{}');
          const one = async (q) => {
            try {
              let r = await prov[k].request({ method: q.method, params: q.params });
              if (k === 'child' && r && (q.method === 'eth_getBlockByHash' || q.method === 'eth_getBlockByNumber') && sendCounts.has(r.hash)) r = Object.assign({}, r, { sendCount: ethers.toQuantity(sendCounts.get(r.hash)) });
              return { jsonrpc: '2.0', id: q.id, result: r };
            } catch (e) { return { jsonrpc: '2.0', id: q.id, error: { code: e.code || -32000, message: e.message } }; }
          };
          const o = Array.isArray(body) ? await Promise.all(body.map(one)) : await one(body);
          return route.fulfill({ status: 200, contentType: 'application/json', headers: h, body: JSON.stringify(o) });
        }
        if (url.startsWith('https://fonts.')) return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
        return route.abort();
      });
      ctxs.push(ctx); return ctx;
    };
    const ctx1 = await newCtx(); const page = await mkPage(ctx1);
    const waitText = (pg, sel, re, ms = 60000) => pg.waitForFunction(([s, r]) => new RegExp(r).test((document.querySelector(s) || {}).textContent || ''), [sel, re.source], { timeout: ms });
    const tokenBal = (a) => token.balanceOf(a);
    const childBal = (a) => eth.child.getBalance(a);

    await page.goto('https://latheon.test/bridge/');
    await waitText(page, '#addrOut', /Inbox, Arbitrum Sepolia/);
    rec('B0. Page loads the bridge entry from deployments.json; contracts listed; no errors',
      (await page.textContent('#depFrom')) === 'Arbitrum Sepolia' && (await page.textContent('#depTo')) === 'Latheon Testnet' && /Rollup/.test(await page.textContent('#addrOut')) && !pageErrors.length);

    await page.click('#connectBtn');
    await waitText(page, '#childLthOut', /LTH/);
    await waitText(page, '#parentLthOut', /1000 LTH/);
    rec('B1. Connected: balances read on both chains (1000 LTH token, 5 LTH on the chain); the connect button hides', /^5 LTH$/.test((await page.textContent('#childLthOut')).trim()) && !(await page.isVisible('#connectBtn')), (await page.textContent('#parentLthOut')) + ' / ' + (await page.textContent('#childLthOut')));

    await page.fill('#depAmount', '5000'); await page.click('#depositBtn');
    await waitText(page, '#depStatus', /You hold 1000 LTH/);
    rec('B2. Deposit above the token balance is refused before any transaction', (await inbox.queryFilter(inbox.filters.Deposited())).length === 0);
    await page.fill('#depAmount', '1,5x'); await page.click('#depositBtn');
    await waitText(page, '#depStatus', /greater than zero/);
    rec('B3. Malformed amount gets a clear message', true);

    const childBefore = await childBal(user);
    await page.fill('#depAmount', '25.5'); await page.click('#depositBtn');
    await waitText(page, '#depStatus', /Arrived/, 90000);
    const allow = await token.allowance(user, await inbox.getAddress());
    rec('B4. Deposit 25.5 LTH: approve exactly the amount, depositERC20, the wallet switched to the parent chain, the page saw it arrive',
      (await tokenBal(await inbox.getAddress())) === 255n * E18 / 10n && allow === 0n && (await childBal(user)) - childBefore === 255n * E18 / 10n && current === 'parent' && credited.length === 1,
      (await page.textContent('#depStatus')).slice(0, 90));

    await page.click('#tab-withdraw');
    await page.fill('#wdAmount', '40'); await page.click('#withdrawBtn');
    await waitText(page, '#wdStatus', /You hold/);
    rec('B5. Withdrawal above the chain balance is refused', current === 'parent');
    await page.fill('#wdDest', '0x1234'); await page.fill('#wdAmount', '10'); await page.click('#withdrawBtn');
    await waitText(page, '#wdStatus', /not a valid address/);
    rec('B6. Bad destination address is refused', true);

    const dest = ethers.getAddress(ethers.dataSlice(ethers.keccak256(ethers.toUtf8Bytes('bridge-e2e-dest')), 12));
    await page.fill('#wdDest', dest.toLowerCase()); await page.fill('#wdAmount', '10'); await page.click('#withdrawBtn');
    await waitText(page, '#wdStatus', /Step 1 done/);
    const addChild = added.find((p) => p.chainId === CHAINS.child.hex);
    const arbsysBal = await childBal(ARBSYS);
    await waitText(page, '#wdList', /waiting for confirmation/);
    rec('B7. Withdrawal of 10 LTH: the wallet added the chain with LTH as its coin, ArbSys.withdrawEth got 10 LTH, the list shows it waiting, no claim button',
      !!addChild && addChild.nativeCurrency.symbol === 'LTH' && arbsysBal === 10n * E18 && !(await page.$('button[data-claim]')) && new RegExp(dest).test(await page.textContent('#wdList')),
      (await page.textContent('#wdList')).replace(/\s+/g, ' ').trim().slice(0, 100));

    // the chain's part: find the L2ToL1Tx, record what the outbox should be asked, confirm a state covering it
    const iface = new ethers.Interface(C.ArbSys.abi);
    const l3Tx = (await page.$eval('#wdList li', (li) => li.dataset.tx));
    const rc = await eth.child.getTransactionReceipt(l3Tx);
    const ev = iface.parseLog(rc.logs[0]).args;
    await (await outbox.connect(op).expect(ev.position, ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['address', 'address', 'uint256', 'uint256', 'uint256', 'uint256', 'bytes'],
      [ev.caller, ev.destination, ev.arbBlockNum, ev.ethBlockNum, ev.timestamp, ev.callvalue, ev.data])))).wait();
    await page.click('#refreshBtn'); await page.waitForTimeout(1500);
    rec('B8. Before confirmation: "Check status" keeps it waiting', /waiting for confirmation/.test(await page.textContent('#wdList')));
    const blk = await prov.child.request({ method: 'eth_getBlockByNumber', params: [ethers.toQuantity(rc.blockNumber), false] });
    sendCounts.set(blk.hash, 1n);
    await (await outbox.connect(op).confirm(blk.hash, 1)).wait();
    await page.waitForTimeout(31000);   // the page caches the confirmed count for 30 s
    await page.click('#refreshBtn');
    await waitText(page, '#wdList', /ready to claim/);
    rec('B9. After the state is confirmed on the parent: ready to claim, claim button shown', !!(await page.$('button[data-claim]')));

    await page.click('button[data-claim]');
    await waitText(page, '#lookupStatus', /Claimed|reverted|Error|error/i, 60000);
    rec('B10. Claim: Outbox.executeTransaction with the right fields and proof; the destination received 10 LTH tokens; marked claimed',
      (await tokenBal(dest)) === 10n * E18 && await outbox.isSpent(ev.position) && /claimed/.test(await page.textContent('#wdList')) && current === 'parent',
      (await page.textContent('#lookupStatus')).slice(0, 100));

    // another browser: nothing stored; find the withdrawal by its hash
    const ctx2 = await newCtx(); const page2 = await mkPage(ctx2);
    await page2.goto('https://latheon.test/bridge/');
    await waitText(page2, '#addrOut', /Inbox/);
    const emptyShown = await page2.isVisible('#wdEmpty');
    await page2.fill('#lookupInput', l3Tx); await page2.click('#lookupBtn');
    await waitText(page2, '#lookupStatus', /Added|No such|no withdrawal/);
    rec('B11. Another browser: empty list, the withdrawal found by its transaction hash and shown as claimed', emptyShown && /claimed/.test(await page2.textContent('#wdList')) && /10 LTH/.test(await page2.textContent('#wdList')));
    const plain = await (await (await eth.child.getSigner(2)).sendTransaction({ to: dest, value: 1n })).wait();
    await page2.fill('#lookupInput', plain.hash); await page2.click('#lookupBtn');
    await waitText(page2, '#lookupStatus', /no withdrawal/);
    await page2.fill('#lookupInput', '0x' + 'ab'.repeat(32)); await page2.click('#lookupBtn');
    await waitText(page2, '#lookupStatus', /No such transaction/);
    rec('B12. A transaction without a withdrawal, and an unknown hash, get clear messages', true);

    await page2.selectOption('#langSelect', 'ru');
    const ru = (await page2.textContent('h1')) + ' | ' + (await page2.textContent('#tab-withdraw')) + ' | ' + (await page2.textContent('#wdList .badge'));
    await page2.selectOption('#langSelect', 'zh');
    const zh = await page2.textContent('h1');
    rec('B13. RU and ZH texts, including the status badge', ru === 'Мост тестового LTH | Вывод в Arbitrum Sepolia | получено' && /跨链桥/.test(zh), ru);
    await page.setViewportSize({ width: 390, height: 900 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    await page.screenshot({ path: path.join(SHOTS, 'bridge-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1200, height: 1100 });
    await page.click('#tab-withdraw');
    await page.screenshot({ path: path.join(SHOTS, 'bridge-withdraw.png'), fullPage: true });
    await page.click('#tab-deposit');
    await page.screenshot({ path: path.join(SHOTS, 'bridge-deposit.png'), fullPage: true });
    rec('B14. No horizontal scroll at phone width', !overflow);
    rec('B15. No JavaScript errors', !pageErrors.length && !consoleMsgs.filter((m) => !/Failed to load resource|net::ERR/.test(m)).length, pageErrors.concat(consoleMsgs).join(' | ').slice(0, 300));
    clearInterval(depositTimer);
  } catch (e) {
    say('ERROR', e.stack || e.message); results.push(['crash', false]);
  } finally {
    if (browser) await browser.close();
    const passed = results.filter((r) => r[1]).length;
    say(`\n${passed} of ${results.length} passed`);
    process.exit(passed === results.length ? 0 : 1);
  }
})();
