// Browser test of the landing page's live counters ("Verify it yourself"): each card must show the sum of nextIndex()
// over that network's V5 and V6 pools, read with eth_call from the RPC in demo/deployments.json; no explorer API is used; the
// label is translated (EN/RU/ZH); a network that does not answer shows a dash and a link to its explorer; no JS errors.
// RPC answers are mocked, so the numbers here are test values. Needs Playwright with Chromium:  node landing-e2e.js
const fs = require('fs'), path = require('path'), R = path.resolve(__dirname, '..', '..');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || '/usr/lib/node_modules/playwright')); }
const cfg = JSON.parse(fs.readFileSync(R + '/demo/deployments.json', 'utf8'));
const nextIdx = {}; cfg.pools.filter(p => p.version === 'v5' || p.version === 'v5-native' || p.version === 'v6-native' || p.version === 'v7-native').forEach((p, i) => nextIdx[p.address.toLowerCase()] = i % 4);
(async () => {
  const results = []; const rec = (n, ok, note) => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + n + (note ? '   [' + note + ']' : '')); };
  for (const mode of ['ok', 'arbDown']) {
    const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const seen = { explorer: 0 };
    await page.route('**/*', async (route) => {
      const u = route.request().url();
      if (u === 'https://latheon.test/') return route.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(R + '/site/index.html', 'utf8') });
      if (u === 'https://latheon.test/demo/deployments.json') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cfg) });
      if (u.startsWith('https://latheon.test/')) { const f = R + '/site/' + u.split('/').pop(); return fs.existsSync(f) ? route.fulfill({ status: 200, body: fs.readFileSync(f) }) : route.fulfill({ status: 404, body: '' }); }
      const net = Object.values(cfg.networks).find(n => u.replace(/\/$/, '') === n.rpcUrl.replace(/\/$/, ''));
      if (net) {
        const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, OPTIONS' };
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors, body: '' });
        if (mode === 'arbDown' && net.chainId === 421614) return route.fulfill({ status: 429, body: 'rate limited' });
        const body = JSON.parse(route.request().postData());
        if (body.method !== 'eth_call' || body.params[0].data !== '0xfc7e9c6f') return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -1, message: 'unexpected' } }) });
        const v = nextIdx[body.params[0].to.toLowerCase()];
        return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ jsonrpc: '2.0', id: body.id, result: '0x' + v.toString(16).padStart(64, '0') }) });
      }
      if (/blockscout|explorer\./.test(u)) seen.explorer++;
      return route.abort();
    });
    await page.goto('https://latheon.test/');
    await page.waitForTimeout(6000);
    const cards = await page.$$eval('#xNets [data-net]', els => els.map(e => [e.getAttribute('data-net'), e.querySelector('.x-num').textContent, e.querySelector('small').textContent]));
    const want = {}; for (const n of Object.keys(cfg.networks)) want[n] = cfg.pools.filter(p => p.network === n && (p.version === 'v5' || p.version === 'v5-native' || p.version === 'v6-native' || p.version === 'v7-native')).reduce((a, p) => a + nextIdx[p.address.toLowerCase()], 0);
    if (mode === 'ok') {
      rec('counters show the sum of nextIndex() per network', cards.every(([n, v]) => Number(v) === want[n]), cards.map(c => c[0] + '=' + c[1]).join(' '));
      rec('label reads "deposits in the pools"', cards.every(c => c[2] === 'deposits in the pools'));
      rec('no request goes to an explorer API', seen.explorer === 0, seen.explorer + ' requests');
      const sub = await page.textContent('[data-xi18n="vf.p"]');
      rec('subtitle says the numbers come from the pool contracts', /pool contracts/.test(sub), sub.slice(0, 60));
      for (const [lang, label] of [['ru', 'депозитов в пулах'], ['zh', '资金池中的存款']]) {
        const sel = await page.$('select'); 
        const switched = await page.evaluate((l) => { const s = [...document.querySelectorAll('select')].find(x => [...x.options].some(o => o.value === l)); if (!s) return false; s.value = l; s.dispatchEvent(new Event('change', { bubbles: true })); return true; }, lang);
        await page.waitForTimeout(500);
        const lab = await page.$$eval('#xNets small', els => els.map(e => e.textContent));
        rec('language ' + lang + ': counter label translated', switched && lab.every(x => x === label), lab[0]);
      }
      await page.evaluate(() => { const s = [...document.querySelectorAll('select')].find(x => [...x.options].some(o => o.value === 'en')); if (s) { s.value = 'en'; s.dispatchEvent(new Event('change', { bubbles: true })); } });
      await page.waitForTimeout(300);
      await page.locator('#xNets').scrollIntoViewIfNeeded(); await page.waitForTimeout(1200);
      await page.screenshot({ path: process.env.SHOT || path.join(require('os').tmpdir(), 'latheon-landing-counters.png'), clip: await page.$eval('#xNets', e => { const r = e.closest('section').getBoundingClientRect(); return { x: 0, y: r.top + window.scrollY, width: 1280, height: Math.min(r.height, 700) }; }), fullPage: true });
    } else {
      const arb = cards.find(c => c[0] === 'arbitrum-sepolia');
      rec('network down: dash and a link to the explorer, others still counted', arb[1] === '—' && /network not responding/.test(arb[2]) && cards.filter(c => c[0] !== 'arbitrum-sepolia').every(([n, v]) => Number(v) === want[n]), arb.join(' | '));
    }
    rec('no JavaScript errors (' + mode + ')', errors.length === 0, errors.slice(0, 2).join(' | '));
    await browser.close();
  }
  const pass = results.filter(Boolean).length; console.log(`\n${pass}/${results.length} checks passed`); process.exit(pass === results.length ? 0 : 1);
})();
