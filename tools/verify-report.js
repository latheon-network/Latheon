#!/usr/bin/env node
'use strict';
/*
 * Checks a Latheon disclosure report file (docs/disclosure-report-format.md) outside the browser.
 *
 *   node tools/verify-report.js REPORT.json --code N            offline: proofs, commitments, the auditor's code, repeats, keys
 *   node tools/verify-report.js REPORT.json --code N --chain    also reads the chain: each deposit exists, withdrawals of keyed notes
 *
 * --code is the one-time code YOU issued. Without it the code written in the file is used, and the result says so:
 * the file then shows that someone knows the keys, not that the report was made for you.
 * Needs `npm ci` in sdk/ once. --chain uses the RPC from sdk/deployments.json (LATHEON_RPC_URL overrides it) and reads
 * whole pools, never a single note. Exit code 0 only when everything checked passed.
 */
const fs = require('fs');
const path = require('path');
const sdkDir = path.resolve(__dirname, '..', 'sdk');
let ethers, sdk;
try { ({ ethers } = require(path.join(sdkDir, 'node_modules', 'ethers'))); sdk = require(path.join(sdkDir, 'src', 'index.js')); }
catch (e) { console.error('Run "npm ci" in the sdk folder first (' + e.message.split('\n')[0] + ')'); process.exit(2); }

(async () => {
  const args = process.argv.slice(2), ci = args.indexOf('--code'), code = ci >= 0 ? args[ci + 1] : undefined, CHAIN = args.includes('--chain');
  const file = args.find((a, i) => !a.startsWith('--') && !(ci >= 0 && i === ci + 1));
  if (!file) { console.log('Usage: node tools/verify-report.js REPORT.json [--code N] [--chain]'); process.exit(2); }
  if (code !== undefined && !/^\d+$/.test(String(code))) { console.error('--code must be the decimal code you issued'); process.exit(2); }
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  const circuit = await sdk.loadCircuit('disclose', { download: true });
  const res = await sdk.verifyReport(report, { circuit, expectedNonce: code });
  console.log(`report: ${report.network} (chain ${report.chainId}), created ${report.created}, ${report.items.length} notes, code ${res.codeFromFile ? 'TAKEN FROM THE FILE (pass --code to check it is yours)' : 'as issued'}`);
  if (CHAIN) {
    const reg = sdk.loadDeployments();
    const pools = sdk.listPools(reg).filter((p) => p.net.chainId === Number(report.chainId));
    if (!pools.length) { console.error('No pools for chain ' + report.chainId + ' in sdk/deployments.json'); process.exit(2); }
    const net = pools[0].net;
    const provider = new ethers.JsonRpcProvider(process.env.LATHEON_RPC_URL || net.rpcUrl, net.chainId, { staticNetwork: true });
    await sdk.checkReportOnChain(res, report, provider, pools);
  }
  const m = (v) => (v === true ? 'ok' : v === false ? 'NO' : '-');
  console.log('\n #  pool        amount   proof  commitment  code  repeat  keys       ' + (CHAIN ? 'deposit  withdrawn  ' : '') + 'label');
  for (const r of res.items) {
    console.log(`${String(r.index + 1).padStart(2)}  ${String(r.pool).slice(0, 10)}  ${String(r.amount + ' ' + r.token).padEnd(8)} ${m(r.proofValid).padEnd(6)} ${m(r.commitmentMatches).padEnd(11)} ${m(r.codeMatches).padEnd(5)} ${(r.duplicate ? 'REPEAT' : '-').padEnd(7)} ${r.keys.padEnd(10)} ` +
      (CHAIN ? `${m(r.poolKnown && r.depositFound && r.statedAmountMatchesPool).padEnd(8)} ${(r.keys === 'match' ? m(r.withdrawnOnChain) : '-').padEnd(10)} ` : '') + (r.label ? '"' + r.label + '" (not proven)' : ''));
  }
  console.log(`\ncounted: ${res.counted} of ${res.items.length} notes, ${res.total || '0'}` + (CHAIN ? '' : ' (amounts as stated in the file; the chain was not read)'));
  if (!CHAIN) { console.log('NOT checked without --chain:'); res.notChecked.forEach((x) => console.log('  - ' + x)); }
  const pass = CHAIN ? res.okOnChain : res.ok;
  console.log('\n' + (pass ? 'PASSED' : 'FAILED') + (res.codeFromFile ? ' (code taken from the file)' : ''));
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('Error: ' + (e.shortMessage || e.message)); process.exit(2); });
