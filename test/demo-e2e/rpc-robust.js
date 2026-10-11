// Tests the RPC helpers of the demo (the block between "rpc-robust:begin" and "rpc-robust:end" in demo/index.html, copied
// verbatim into sdk/demo-app-v5.html) against fake endpoints modelled on real ones: one that answers any block range
// (sepolia-rollup.arbitrum.io did 2.1M blocks in one request), one capped at 50,000 blocks (publicnode), one capped at
// 10,000 with HTTP 400 (drpc free plan), plus transient errors ("could not coalesce error", "Failed to fetch",
// "pruned history unavailable"). No network and no packages needed:  node rpc-robust.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const html = fs.readFileSync(path.resolve(__dirname, '..', '..', 'demo', 'index.html'), 'utf8');
const m = html.match(/\/\/ rpc-robust:begin\n([\s\S]*?)\/\/ rpc-robust:end/);
if (!m) { console.log('FAIL rpc-robust block not found in demo/index.html'); process.exit(1); }

const logs = [];
const ctx = { setTimeout: (f) => setImmediate(f), log: (x) => logs.push(x), Math, Promise, String, JSON, Array, Map, Error };
vm.createContext(ctx);
vm.runInContext(m[1] + '\nthis.H = { withRetry, getLogsAdaptive, rpcLimiter, mapLimit, rpcIsRangeError, RPC_CHUNK };', ctx);
const H = ctx.H;

const results = [];
const check = (name, ok, note) => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (note ? '   [' + note + ']' : '')); };
const err = (msg, extra) => Object.assign(new Error(msg), extra || {});
const coalesce = () => err('could not coalesce error (error={ "code": -32603, "message": "upstream" })', { code: 'UNKNOWN_ERROR' });
const failedFetch = () => err('Failed to fetch');
const pruned = () => err('could not coalesce error', { code: 'UNKNOWN_ERROR', error: { code: 4444, message: 'pruned history unavailable' } });
const cap50k = () => err('could not coalesce error', { code: 'UNKNOWN_ERROR', error: { code: -32701, message: 'exceed maximum block range: 50000' } });
const cap9k = () => err('could not coalesce error', { code: 'UNKNOWN_ERROR', error: { code: -32701, message: 'exceed maximum block range: 9000' } });
const cap10k = () => err('ranges over 10000 blocks are not supported on free plan', { code: 'UNKNOWN_ERROR' });
// One fake log per 1000 blocks, so completeness and order are easy to check.
const fakeLogs = (a, b) => { const r = []; for (let x = Math.ceil(a / 1000) * 1000; x <= b; x += 1000) r.push(x); return r; };
const expected = (a, b) => fakeLogs(a, b).join(',');
const A = 315679153, Z = 317776236;   // the real Arbitrum Sepolia span of the V5 pools, about 2.1M blocks

(async () => {
  // 1. An endpoint that answers any range: one request for the whole span.
  {
    let calls = 0;
    const out = await H.getLogsAdaptive(async (a, b) => { calls++; return fakeLogs(a, b); }, A, Z, 'scan');
    check('endpoint without a range cap: 2.1M blocks in exactly 1 request', calls === 1 && out.join(',') === expected(A, Z), calls + ' request');
  }
  // 2. A 50,000-block cap: split until it fits, complete and in order, far fewer requests than 9000-block chunks (233).
  {
    let calls = 0, maxOk = 0;
    const out = await H.getLogsAdaptive(async (a, b) => { calls++; if (b - a + 1 > 50000) throw cap50k(); maxOk = Math.max(maxOk, b - a + 1); return fakeLogs(a, b); }, A, Z, 'scan');
    check('50,000-block cap (publicnode): split, complete, in order', out.join(',') === expected(A, Z) && maxOk <= 50000 && calls < 233, calls + ' requests');
  }
  // 3. A 10,000-block cap answered with HTTP 400.
  {
    let calls = 0;
    const out = await H.getLogsAdaptive(async (a, b) => { calls++; if (b - a + 1 > 10000) throw cap10k(); return fakeLogs(a, b); }, 5000, 104999, 'scan');
    check('10,000-block cap (drpc free plan): split and complete', out.join(',') === expected(5000, 104999), calls + ' requests');
  }
  // 4. Transient errors on small ranges (here: an endpoint capped at 9000 blocks) are retried with backoff and logged.
  {
    const seen = new Set(); let calls = 0;
    const get = async (a, b) => { calls++; if (b - a + 1 > 9000) throw cap9k(); const k = a + '-' + b; if (!seen.has(k) && calls % 3 === 0) { seen.add(k); throw coalesce(); } return fakeLogs(a, b); };
    const out = await H.getLogsAdaptive(get, A, A + 199999, 'scan');
    check('"could not coalesce error" is retried; scan complete', out.join(',') === expected(A, A + 199999), seen.size + ' failures recovered');
  }
  // 5. "Failed to fetch" (a 429 without CORS headers) on the big request: split, then complete.
  {
    let calls = 0;
    const out = await H.getLogsAdaptive(async (a, b) => { calls++; if (b - a + 1 > 300000) throw failedFetch(); return fakeLogs(a, b); }, A, Z, 'scan');
    check('"Failed to fetch" on a large range: split and complete', out.join(',') === expected(A, Z), calls + ' requests');
  }
  // 6. A pool of nodes where some have pruned history: retried until a full node answers.
  {
    let calls = 0;
    const out = await H.getLogsAdaptive(async (a, b) => { calls++; if (calls % 2 === 1) throw pruned(); return fakeLogs(a, b); }, 11842583, 11885405, 'scan');
    check('"pruned history unavailable" is retried', out.join(',') === expected(11842583, 11885405), calls + ' requests');
  }
  // 7. Range errors are recognised, transient errors are not range errors.
  check('range errors recognised (50k, 10k caps); transient errors are not', H.rpcIsRangeError(cap50k()) && H.rpcIsRangeError(cap10k()) && !H.rpcIsRangeError(coalesce()) && !H.rpcIsRangeError(pruned()) && !H.rpcIsRangeError(failedFetch()));
  // 8. A contract error is thrown at once.
  {
    let calls = 0;
    let threw = false; try { await H.withRetry(async () => { calls++; throw err('execution reverted', { code: 'CALL_EXCEPTION' }); }, 'call'); } catch (e) { threw = e.code === 'CALL_EXCEPTION'; }
    check('CALL_EXCEPTION is thrown at once, without retries', threw && calls === 1, calls + ' call');
  }
  // 9. An endpoint that is down: the scan ends with the original error, in a bounded number of requests.
  {
    let calls = 0;
    let threw = false; try { await H.getLogsAdaptive(async () => { calls++; throw coalesce(); }, A, Z, 'scan'); } catch (e) { threw = /coalesce/.test(e.message); }
    check('endpoint down: stops after the failure budget with the original error', threw && calls <= 50, calls + ' requests');
  }
  // 10. At most 8 requests in flight, even while ranges are being split.
  {
    let inFlight = 0, peak = 0;
    const get = async (a, b) => { inFlight++; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 1)); inFlight--; if (b - a + 1 > 20000) throw cap50k(); return fakeLogs(a, b); };
    const out = await H.getLogsAdaptive(get, A, A + 999999, 'scan');
    check('at most 8 requests in flight while splitting', peak <= 8 && out.join(',') === expected(A, A + 999999), 'peak ' + peak);
  }
  // 11. mapLimit keeps the order of results.
  {
    const out = await H.mapLimit([...Array(20).keys()], 4, async (x) => { await new Promise((r) => setTimeout(r, x % 3)); return x * 2; });
    check('mapLimit preserves order', out.join(',') === [...Array(20).keys()].map((x) => x * 2).join(','));
  }
  // 12. The log stays short: retries on small ranges are logged, retries on large ranges are not, splitting is summarised.
  check('log: small-range retries logged with the error, large-range noise summarised',
    logs.some((l) => /Retry 1\/3/.test(l) && /coalesce/.test(l)) && logs.some((l) => /range was split/.test(l)) && !logs.some((l) => /RPC error during scan 315679153–317776236/.test(l)));
  // 13. The reference app carries a verbatim copy of the same block.
  {
    const ref = fs.readFileSync(path.resolve(__dirname, '..', '..', 'sdk', 'demo-app-v5.html'), 'utf8').match(/\/\/ rpc-robust:begin\n([\s\S]*?)\/\/ rpc-robust:end/);
    check('sdk/demo-app-v5.html has the same rpc-robust block as demo/index.html', !!ref && ref[1] === m[1]);
  }

  const pass = results.filter(Boolean).length;
  console.log(`\n${pass}/${results.length} checks passed`);
  process.exit(pass === results.length ? 0 : 1);
})();
