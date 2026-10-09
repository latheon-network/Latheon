// Unit checks for the wallet-side helpers in sdk/distribution.js: master key derivation, master key text format,
// deposit planning and picking notes for a withdrawal. Fast (no chain, no proofs): `node wallet.js`.
// With DEMO=/path/to/demo/index.html it also checks that the copy of the helpers inside the demo is identical.
const fs = require('fs');
const path = require('path');
const { poseidon4, poseidon2 } = require('poseidon-lite');
const D = require(path.join(__dirname, '../../sdk/distribution.js'));

let fails = 0, n = 0;
const ok = (name, cond, note) => { n++; if (!cond) fails++; console.log((cond ? 'ok   ' : 'FAIL ') + name + (note ? '   [' + note + ']' : '')); };
const throws = (f) => { try { f(); return false; } catch (e) { return true; } };
const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const E18 = 10n ** 18n, DEN = [100n * E18, 50n * E18, 10n * E18, 1n * E18];

// ---- derivation
const a = D.deriveNoteKeys(poseidon4, 12345n, 421614, 0), a2 = D.deriveNoteKeys(poseidon4, 12345n, 421614, 0);
ok('derivation is deterministic', a.spendKey === a2.spendKey && a.viewKey === a2.viewKey);
const seen = new Set();
for (const m of [12345n, 12346n]) for (const c of [421614, 46630]) for (let i = 0; i < 64; i++) { const k = D.deriveNoteKeys(poseidon4, m, c, i); seen.add(k.spendKey); seen.add(k.viewKey); }
ok('2 masters x 2 chains x 64 indices x 2 keys are all different', seen.size === 2 * 2 * 64 * 2, seen.size + ' values');
ok('derived keys are valid field elements', [...seen].every((v) => v > 0n && v < FIELD));
ok('spendKey and viewKey of a note differ', a.spendKey !== a.viewKey);
ok('commitments of different notes differ', (() => { const s = new Set(); for (let i = 0; i < 64; i++) { const k = D.deriveNoteKeys(poseidon4, 777n, 1, i); s.add(poseidon2([poseidon2([k.spendKey, k.viewKey]), 0n])); } return s.size === 64; })());

// ---- master key text
const router = '0x284985291A32cf0cfE48F6CA128615983952350e';
const text = D.formatMasterKey(421614, router, 987654321n);
const back = D.parseMasterKey('  ' + text + '\n');
ok('master key text round-trips', back.chainId === 421614 && back.router === router && back.master === 987654321n, text);
ok('master key parser rejects junk', ['', 'latheon-v5:1:2:3:4', 'latheon-master:1:0x12:5', 'latheon-master:x:' + router + ':5', 'latheon-master:1:' + router + ':-5', 'latheon-master:1:' + router + ':5:6', 'latheon-master:1:' + router].every((t) => throws(() => D.parseMasterKey(t))));

// ---- deposit planning
let p = D.planDeposit(160n * E18, DEN, 'exact');
ok('exact 160 -> 100+50+10, no remainder', p.total === 3n && p.remainder === 0n && p.counts.join() === '1,1,1,0');
p = D.planDeposit(99n * E18, DEN, 'exact');
ok('exact 99 -> 0,1,4,9 (14 notes)', p.total === 14n && p.counts.join() === '0,1,4,9');
ok('exact refuses 1.5 tokens', throws(() => D.planDeposit(3n * E18 / 2n, DEN, 'exact')));
p = D.planDeposit(99n * E18 + E18 / 2n, DEN, 'round', E18);
ok('round to 1 token: 99.5 -> 99, remainder 0.5', p.amount === 99n * E18 && p.remainder === E18 / 2n);
p = D.planDeposit(99n * E18, DEN, 'round', 10n * E18);
ok('round to 10: 99 -> 90 (one 50, four 10), remainder 9', p.amount === 90n * E18 && p.remainder === 9n * E18 && p.counts.join() === '0,1,4,0');
ok('round to 100 of 99 gives zero and refuses', throws(() => D.planDeposit(99n * E18, DEN, 'round', 100n * E18)));
ok('order lists the largest pool first', D.planDeposit(151n * E18, DEN, 'exact').order.map((x) => x / E18).join() === '100,50,1');

// ---- picking notes
const mk = (vals) => vals.map((v, i) => ({ id: i, value: v }));
let r = D.selectNotes(mk([100, 50, 50, 10, 1]), 100);
ok('picks the single 100 rather than 50+50', r.chosen && r.chosen.length === 1 && r.chosen[0].value === 100);
r = D.selectNotes(mk([50, 50, 10, 1, 1]), 101);
ok('101 from 50,50,10,1,1 -> 50+50+1', r.chosen && r.chosen.reduce((s, x) => s + x.value, 0) === 101 && r.chosen.length === 3);
r = D.selectNotes(mk([50, 10, 1]), 100);
ok('100 not reachable from 50,10,1 -> null, nearest 61', r.chosen === null && r.nearest === 61, 'nearest ' + r.nearest);
r = D.selectNotes(mk([10, 10]), 30);
ok('no note is used twice: 30 from 10,10 -> null, nearest 20', r.chosen === null && r.nearest === 20);
r = D.selectNotes(mk([100]), 1);
ok('1 from a single 100 -> null, nearest 0 (no change)', r.chosen === null && r.nearest === 0);
r = D.selectNotes([], 5);
ok('no notes -> null, nearest 0', r.chosen === null && r.nearest === 0);
r = D.selectNotes(mk([1, 1, 1, 1, 1]), 3);
ok('3 from five 1s -> three notes', r.chosen && r.chosen.length === 3);
ok('returned notes are the caller\'s objects, each at most once', (() => { const ns = mk([5, 5, 5, 20]); const c = D.selectNotes(ns, 25).chosen; return c.length === 2 && new Set(c.map((x) => x.id)).size === 2 && c.every((x) => ns.includes(x)); })());
ok('bad targets refused', throws(() => D.selectNotes(mk([1]), 0)) && throws(() => D.selectNotes(mk([1]), 1.5)) && throws(() => D.selectNotes(mk([1]), 2e6)));
// randomised cross-check against brute force
let mism = 0;
for (let t = 0; t < 300; t++) {
  const cnt = 1 + Math.floor(Math.random() * 9), vals = Array.from({ length: cnt }, () => [1, 1, 10, 10, 50, 100][Math.floor(Math.random() * 6)]);
  const target = 1 + Math.floor(Math.random() * 260);
  let bestCnt = Infinity, bestSum = 0;
  for (let m = 0; m < 1 << cnt; m++) { let s = 0, c = 0; for (let i = 0; i < cnt; i++) if (m >> i & 1) { s += vals[i]; c++; } if (s === target && c < bestCnt) bestCnt = c; if (s <= target && s > bestSum) bestSum = s; }
  const res = D.selectNotes(mk(vals), target);
  const exp = bestCnt === Infinity ? null : bestCnt;
  if ((res.chosen ? res.chosen.length : null) !== exp || (!res.chosen && res.nearest !== bestSum) || (res.chosen && res.chosen.reduce((s, x) => s + x.value, 0) !== target)) mism++;
}
ok('300 random cases agree with brute force (fewest notes, nearest sum)', mism === 0, mism + ' mismatches');

// ---- the copy inside the demo
if (process.env.DEMO) {
  const block = (t) => { const a = t.indexOf('distribution-core:begin'), b = t.indexOf('distribution-core:end'); return t.slice(a, b).split('\n').slice(1).join('\n').replace(/\s+/g, ' ').trim(); };
  const sdk = block(fs.readFileSync(path.join(__dirname, '../../sdk/distribution.js'), 'utf8'));
  const demo = block(fs.readFileSync(process.env.DEMO, 'utf8'));
  ok('demo carries an identical copy of the helpers', sdk.length > 500 && sdk === demo, sdk.length + ' / ' + demo.length + ' chars');
} else console.log('skip demo-copy check (set DEMO=path/to/demo/index.html)');

console.log(fails ? '\n' + fails + ' of ' + n + ' FAILED' : '\nALL ' + n + ' CHECKS PASSED');
process.exit(fails ? 1 : 0);
