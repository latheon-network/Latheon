#!/usr/bin/env node
'use strict';
/*
 * Fills the provenance fields of the current (V7, not frozen) entries of sdk/deployments.json from the chain itself.
 * Needs network access to the network's RPC and block explorer; it adds no packages.
 *
 *   node tools/registry-fill.js            report only: what the chain says about every current entry
 *   node tools/registry-fill.js --write    also write the fields into sdk/deployments.json and demo/deployments.json
 *
 * Per entry it sets:
 *   deployTx      hash of the transaction that created the contract (looked up in the block "deployBlock")
 *   commit        the Latheon commit the contract was built from (--commit <sha>, default: 129a4c0, see docs/testnet.md)
 *   verification  { "blockscout": true|false, "checked": "YYYY-MM-DD" }: whether the explorer shows verified source
 * and refuses to write an entry when eth_getCode returns no code at its address.
 * Options: --registry <file> (default sdk/deployments.json; the demo copy is then written too only for the default),
 *          --commit <sha>, --network <id>.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const WRITE = args.includes('--write');
const COMMIT = opt('commit', '129a4c0d38af03b0ad2db59e8ad01823e813ed77');
const ONLY = opt('network', null);
const defaultFile = path.join(ROOT, 'sdk', 'deployments.json');
const regFile = path.resolve(opt('registry', defaultFile));
const isDefault = regFile === defaultFile;
const demoFile = path.join(ROOT, 'demo', 'deployments.json');

if (!/^[0-9a-f]{40}$/.test(COMMIT)) { console.error('--commit must be a full 40-character lower-case sha'); process.exit(2); }

const raw = fs.readFileSync(regFile, 'utf8');
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
const reg = JSON.parse(raw);
const isV7 = (x) => /^v7/.test(String(x.version || ''));

async function rpc(url, method, params) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(method + ': ' + JSON.stringify(j.error));
  return j.result;
}

async function creationTx(url, entry) {
  const blk = await rpc(url, 'eth_getBlockByNumber', ['0x' + entry.deployBlock.toString(16), true]);
  if (!blk) return null;
  for (const tx of blk.transactions) {
    if (tx.to !== null) continue;
    const rc = await rpc(url, 'eth_getTransactionReceipt', [tx.hash]);
    if (rc && rc.contractAddress && rc.contractAddress.toLowerCase() === entry.address.toLowerCase()) return tx.hash.toLowerCase();
  }
  return null;
}

async function blockscoutVerified(api, address) {
  const r = await fetch(api.replace(/\/$/, '') + '/smart-contracts/' + address);
  if (r.status === 404) return false;
  if (!r.ok) throw new Error('blockscout HTTP ' + r.status);
  const j = await r.json();
  return j.is_verified === true || j.is_fully_verified === true;
}

(async () => {
  const today = new Date().toISOString().slice(0, 10);
  const entries = [...(reg.pools || []), ...(reg.routers || [])].filter((x) => isV7(x) && !x.frozen && (!ONLY || x.network === ONLY));
  let problems = 0;
  for (const e of entries) {
    const net = reg.networks[e.network];
    if (!net || !net.rpcUrl) { console.log(`SKIP ${e.id}: no rpcUrl for ${e.network}`); continue; }
    try {
      const chainId = await rpc(net.rpcUrl, 'eth_chainId', []);
      if (net.chainId && parseInt(chainId, 16) !== net.chainId) throw new Error(`chain id ${parseInt(chainId, 16)} is not ${net.chainId}`);
      const code = await rpc(net.rpcUrl, 'eth_getCode', [e.address, 'latest']);
      if (!code || code === '0x') throw new Error('no contract code at ' + e.address);
      const tx = await creationTx(net.rpcUrl, e);
      let ver = null;
      if (net.blockscoutApi) { try { ver = await blockscoutVerified(net.blockscoutApi, e.address); } catch (err) { console.log(`  note ${e.id}: explorer check failed (${err.message})`); } }
      console.log(`${e.id}\n  code ${(code.length - 2) / 2} bytes, creation tx ${tx || 'NOT FOUND in block ' + e.deployBlock}, explorer-verified ${ver === null ? 'unknown' : ver}`);
      if (!tx) { problems++; continue; }
      if (WRITE) {
        e.deployTx = tx;
        e.commit = COMMIT;
        if (ver !== null) e.verification = { blockscout: ver, checked: today };
      }
    } catch (err) { problems++; console.log(`FAIL ${e.id}: ${err.message}`); }
  }
  if (WRITE) {
    if (problems) { console.log(`not written: ${problems} problem(s); fix them and run again`); process.exit(1); }
    const out = JSON.stringify(reg, null, 2).replace(/\n/g, eol) + (raw.endsWith('\n') ? eol : '');
    fs.writeFileSync(regFile, out);
    if (isDefault) fs.writeFileSync(demoFile, out);
    console.log('written: ' + path.relative(ROOT, regFile) + (isDefault ? ' and demo/deployments.json' : ''));
  } else console.log(problems ? `${problems} problem(s)` : 'report only; run with --write to store the fields');
  process.exit(problems ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
