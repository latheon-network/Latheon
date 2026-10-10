// Tests the RPC helpers of the demo (the block between "rpc-robust:begin" and "rpc-robust:end" in demo/index.html):
// retries on transient errors, splitting of refused block ranges, no retry on contract errors, bounded concurrency.
// No network and no packages needed:  node rpc-robust.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const html = fs.readFileSync(path.resolve(__dirname, '..', '..', 'demo', 'index.html'), 'utf8');
const m = html.match(/\/\/ rpc-robust:begin\n([\s\S]*?)\/\/ rpc-robust:end/);
if (!m) { console.log('FAIL rpc-robust block not found in demo/index.html'); process.exit(1); }

const logs = [];
const ctx = { setTimeout: (f) => setImmediate(f), log: (x) => logs.push(x), Math, Promise, String, JSON, Array };
vm.createContext(ctx);
vm.runInContext(m[1] + '\nthis.H = { withRetry, getLogsRobust, mapLimit, rpcIsRangeError };', ctx);
const H = ctx.H;

const results = [];
const check = (name, ok, note) => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (note ? '   [' + note + ']' : '')); };
const coalesce = () => Object.assign(new Error('could not coalesce error (error={ "code": -32603, "message": "upstream" })'), { code: 'UNKNOWN_ERROR' });
const rangeErr = () => Object.assign(new Error('could not coalesce error'), { code: 'UNKNOWN_ERROR', error: { code: -32600, message: 'eth_getLogs block range is too large, max is 2000' } });
// One fake log per 100 blocks, so completeness and order are easy to check.
const fakeLogs = (a, b) => { const r = []; for (let x = Math.ceil(a / 100) * 100; x <= b; x += 100) r.push(x); return r; };
const expected = (a, b) => fakeLogs(a, b).join(',');

(async () => {
  // 1. Transient errors: every third call fails once.
  {
    let n = 0; const seen = new Set();
    const get = async (a, b) => { n++; const k = a + '-' + b; if (n % 3 === 0 && !seen.has(k)) { seen.add(k); throw coalesce(); } return fakeLogs(a, b); };
    const ranges = []; for (let f = 1000; f <= 60000; f += 9000) ranges.push([f, Math.min(f + 8999, 60000)]);
    const out = (await H.mapLimit(ranges, 4, ([f, t]) => H.getLogsRobust(get, f, t, 'scan'))).flat();
    check('transient "could not coalesce error" is retried, scan complete and in order', out.join(',') === expected(1000, 60000), seen.size + ' failures recovered');
  }
  // 2. Range limit: the endpoint refuses more than 2000 blocks; the helper splits until it fits.
  {
    let calls = 0;
    const get = async (a, b) => { calls++; if (b - a + 1 > 2000) throw rangeErr(); return fakeLogs(a, b); };
    const out = await H.getLogsRobust(get, 5000, 13999, 'scan');
    check('refused block range is split and fully covered', out.join(',') === expected(5000, 13999), calls + ' requests');
    check('range errors are recognised (not retried as transient)', H.rpcIsRangeError(rangeErr()) && !H.rpcIsRangeError(coalesce()));
  }
  // 3. A contract error is not retried.
  {
    let calls = 0;
    const fn = async () => { calls++; throw Object.assign(new Error('execution reverted'), { code: 'CALL_EXCEPTION' }); };
    let threw = false; try { await H.withRetry(fn, 'call'); } catch (e) { threw = e.code === 'CALL_EXCEPTION'; }
    check('CALL_EXCEPTION is thrown at once, without retries', threw && calls === 1, calls + ' call');
  }
  // 4. An endpoint that is down: give up after the retries instead of looping forever.
  {
    let calls = 0;
    const get = async () => { calls++; throw coalesce(); };
    let threw = false; try { await H.getLogsRobust(get, 1, 200, 'scan'); } catch (e) { threw = /coalesce/.test(e.message); }
    check('persistent failure ends with the original error after 4 attempts', threw && calls === 4, calls + ' calls');
  }
  // 5. A persistent failure on a large range ends too (split down to the minimum span, then the error surfaces).
  {
    let calls = 0;
    const get = async () => { calls++; throw coalesce(); };
    let threw = false; try { await H.getLogsRobust(get, 1, 9000, 'scan'); } catch (e) { threw = true; }
    check('persistent failure on a 9000-block range still terminates', threw && calls < 200, calls + ' calls');
  }
  // 6. Bounded concurrency and order of results.
  {
    let inFlight = 0, peak = 0;
    const out = await H.mapLimit([...Array(20).keys()], 4, async (x) => { inFlight++; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 2 + (x % 3))); inFlight--; return x * 2; });
    check('mapLimit keeps at most 4 requests in flight and preserves order', peak <= 4 && out.join(',') === [...Array(20).keys()].map((x) => x * 2).join(','), 'peak ' + peak);
  }
  // 7. The retry log names the operation and the error, so a user can report it.
  check('retries are logged with the operation and the error text', logs.some((l) => /Retry 1\/3/.test(l) && /coalesce/.test(l)));

  const pass = results.filter(Boolean).length;
  console.log(`\n${pass}/${results.length} checks passed`);
  process.exit(pass === results.length ? 0 : 1);
})();
