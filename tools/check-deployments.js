#!/usr/bin/env node
'use strict';
/*
 * Offline consistency check of the address registry and the documents (no network, no packages).
 *
 * Fails (exit 1) when:
 *   1. sdk/deployments.json and demo/deployments.json differ;
 *   2. a pool that is not V7 lacks "frozen": true and "forgeable": true, or a router that is not V7 lacks "frozen": true;
 *   3. a document (every *.md in the repository, and site/index.html, where each line is judged on its own) shows the address of a frozen or forgeable pool
 *      or router next to a deposit instruction, without a warning (frozen / deprecated / do not deposit / withdrawals
 *      only ...) in the same paragraph, table row or section;
 *   4. a document shows such an address with no warning at all: not in its paragraph or table row, not in its section,
 *      and not at the top of the file (first 15 lines), so a reader could take it for a current contract.
 * Warns (no failure) on a V7 entry marked frozen and on addresses of frozen entries in code outside deployments.json.
 *
 *   node tools/check-deployments.js [--verbose] [extra-dir ...]
 * Extra directories (for example a checkout of latheon-network/l2-eval-ci) have their *.md files checked as documents too.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const VERBOSE = args.includes('--verbose');
const EXTRA_DIRS = args.filter((a) => !a.startsWith('--')).map((d) => path.resolve(d));

// Pre-V7 contracts that are not (or not for their own network) in deployments.json but appear in documents.
// The V3 pool on Ethereum Sepolia is the default of the old SDK's deposit(); the earlier Ethereum V4 pool was replaced.
const EXTRA_FROZEN = [
  { address: '0x9d047AdA4e33D28fBd86220f3F899A7Df7e3360C', id: 'ethereum-sepolia:V3 pool (LatheonShieldedPoolV3)' },
  { address: '0x5E81DB3aE24B5B6d7E4d853933EF37b55d2ccDC7', id: 'ethereum-sepolia:earlier V4 pool (replaced)' },
];

// Same address as a pre-V7 pool, but a different contract on another network (deployer nonces repeat across chains):
// shown in documents for that other contract, so only a deposit instruction next to it counts.
const OTHER_CONTRACT = new Map([
  ['0xf4ab260e65d7c6bee3d1192d2cef677199b1f214', 'LatheonFaucet on Ethereum Sepolia'],
]);

const failures = [], warnings = [];
const fail = (m) => failures.push(m), warn = (m) => warnings.push(m);
const rel = (f) => path.relative(ROOT, f) || f;
const isV7 = (x) => /^v7/.test(String(x.version || ''));

// ---------- 1. the two copies of deployments.json
const sdkPath = path.join(ROOT, 'sdk', 'deployments.json'), demoPath = path.join(ROOT, 'demo', 'deployments.json');
const sdkRaw = fs.readFileSync(sdkPath, 'utf8'), demoRaw = fs.readFileSync(demoPath, 'utf8');
const dep = JSON.parse(sdkRaw), demoDep = JSON.parse(demoRaw);
if (sdkRaw !== demoRaw) {
  if (JSON.stringify(dep) === JSON.stringify(demoDep)) warn('sdk/deployments.json and demo/deployments.json have the same content but different formatting');
  else fail('sdk/deployments.json and demo/deployments.json differ (they must be identical; copy one over the other)');
}

// ---------- 2. flags of every pre-V7 entry
for (const p of dep.pools || []) {
  if (isV7(p)) { if (p.frozen || p.forgeable) warn(`V7 pool ${p.id} is marked frozen/forgeable`); continue; }
  const miss = ['frozen', 'forgeable'].filter((k) => p[k] !== true);
  if (miss.length) fail(`pool ${p.id} (${p.version || 'no version'}, ${p.address}) is not V7 but lacks ${miss.map((k) => '"' + k + '": true').join(' and ')}`);
}
for (const r of dep.routers || []) {
  if (isV7(r)) { if (r.frozen) warn(`V7 router ${r.id} is marked frozen`); continue; }
  if (r.frozen !== true) fail(`router ${r.id} (${r.version || 'v5'}, ${r.address}) is not V7 but lacks "frozen": true`);
}

// ---------- 3. documents
const frozen = new Map();   // lower-case address -> ids
const add = (a, id) => { const k = a.toLowerCase(); frozen.set(k, [...(frozen.get(k) || []), id]); };
for (const x of [...(dep.pools || []), ...(dep.routers || [])]) if (x.frozen || x.forgeable || !isV7(x)) add(x.address, x.id);
for (const x of EXTRA_FROZEN) add(x.address, x.id);
const current = new Set([...(dep.pools || []), ...(dep.routers || [])].filter((x) => isV7(x) && !x.frozen).map((x) => x.address.toLowerCase()));
for (const a of frozen.keys()) if (current.has(a)) warn(`address ${a} is listed both as current V7 and as frozen`);

// A deposit instruction: words that tell the reader to deposit (not counts of deposits or event names).
const DEPOSIT_RE = /\b(deposit (in|into|to)\b|to deposit\b|you deposit\b|please deposit|deposit (100|50|10|1|any|your|some|test)\b|deposit (LTH|USDG|funds|tokens)\b|\.deposit\(|depositBtn|approve\b.*\bdeposit|try it)/i;
// A warning that makes the address safe to show.
const WARN_RE = /(do not deposit|don't deposit|never deposit|must not (receive|get|take)? ?deposit|not deposit|frozen|deprecated|forgeable|superseded|withdrawals? (of existing notes )?only|only (so|for) (that )?(existing |their |its )?notes|kept only|legacy|retired|replaced|pre-V7|before V7)/i;

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'vendor') continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out); else out.push(f);
  }
  return out;
}

const ADDR_RE = /0x[0-9a-fA-F]{40}/g;
function checkDoc(file) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const isMd = file.endsWith('.md');
  // sections: from one markdown heading to the next (for HTML: a window of lines around the hit)
  const headingAt = []; let h = 0;
  lines.forEach((l, i) => { if (isMd && /^#{1,6}\s/.test(l)) h = i; headingAt[i] = h; });
  const sectionEnd = (i) => { let j = i + 1; while (j < lines.length && !/^#{1,6}\s/.test(lines[j])) j++; return j; };
  const blockOf = (i) => {   // the paragraph or table row containing line i
    if (isMd && /^\s*\|/.test(lines[i])) return lines[i];
    if (!isMd) return lines[i];   // HTML: the line itself (one list entry with its label)
    let a = i, b = i;
    while (a > 0 && lines[a - 1].trim() !== '' && !/^#{1,6}\s/.test(lines[a - 1])) a--;
    while (b + 1 < lines.length && lines[b + 1].trim() !== '') b++;
    return lines.slice(a, b + 1).join('\n');
  };
  lines.forEach((line, i) => {
    for (const m of line.matchAll(ADDR_RE)) {
      const ids = frozen.get(m[0].toLowerCase());
      if (!ids) continue;
      const block = blockOf(i);
      const section = isMd ? lines.slice(headingAt[i], sectionEnd(i)).join('\n') : lines[i];
      const instr = DEPOSIT_RE.test(block) || (isMd && DEPOSIT_RE.test(lines[headingAt[i]] || ''));
      const warned = WARN_RE.test(block) || WARN_RE.test(section);
      const headWarned = isMd && WARN_RE.test(lines.slice(0, 15).join('\n'));
      if (!warned && !headWarned && !instr && !OTHER_CONTRACT.has(m[0].toLowerCase())) fail(`${rel(file)}:${i + 1}: frozen ${ids.join(' / ')} (${m[0]}) shown with no warning in its paragraph, section or at the top of the file`);
      if (instr && !warned) fail(`${rel(file)}:${i + 1}: frozen ${ids.join(' / ')} (${m[0]}) next to a deposit instruction, with no warning in the paragraph or section`);
      else if (VERBOSE) console.log(`  ok ${rel(file)}:${i + 1} ${m[0]} ${instr ? '(deposit wording, warned)' : ''}`);
    }
  });
}

const files = walk(ROOT, []);
const docs = files.filter((f) => f.endsWith('.md') || rel(f) === path.join('site', 'index.html'));
for (const d of EXTRA_DIRS) docs.push(...walk(d, []).filter((f) => f.endsWith('.md')));
docs.forEach(checkDoc);

// Addresses of frozen entries in code outside deployments.json: not a failure, listed so they are not forgotten.
const CODE_EXT = /\.(js|mjs|cjs|ts|html|sh|json)$/;
for (const f of files) {
  if (!CODE_EXT.test(f) || f === __filename || f === sdkPath || f === demoPath || docs.includes(f) || /package(-lock)?\.json$/.test(f)) continue;
  const text = fs.readFileSync(f, 'utf8');
  const hits = [...new Set((text.match(ADDR_RE) || []).map((a) => a.toLowerCase()).filter((a) => frozen.has(a) && !OTHER_CONTRACT.has(a)))];
  if (hits.length) warn(`${rel(f)}: ${hits.length} frozen address(es) written in code (${hits.map((a) => frozen.get(a).join(' = ')).join(', ')}); read them from deployments.json instead`);
}

console.log(`check-deployments: ${(dep.pools || []).length} pools, ${(dep.routers || []).length} routers, ${frozen.size} frozen addresses, ${docs.length} documents`);
for (const w of warnings) console.log('WARN ' + w);
for (const f of failures) console.log('FAIL ' + f);
console.log(failures.length ? `${failures.length} problem(s)` : 'OK');
process.exit(failures.length ? 1 : 0);
