// The disclosure report file: build, check offline, test vectors (docs/disclosure-report-format.md).
//   node test/report.js            checks; UPDATE_VECTORS=1 rewrites test/vectors/disclosure-report/valid-v1.json
const fs = require('fs');
const path = require('path');
const sdk = require('../src/index');

const VEC = path.resolve(__dirname, '..', '..', 'test', 'vectors', 'disclosure-report');
let n = 0, fails = 0;
const ok = (name, cond, note) => { n++; if (!cond) fails++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (note ? '   [' + note + ']' : '')); };
const rejects = async (fn, re) => { try { await fn(); return false; } catch (e) { return re ? re.test(e.message) : true; } };
const clone = (x) => JSON.parse(JSON.stringify(x));

(async () => {
  const reg = sdk.loadDeployments();
  const pools = sdk.listPools(reg, { depositable: true }), net = pools[0].net;
  const pool1 = pools.find((p) => p.amount === 1), pool100 = pools.find((p) => p.amount === 100);
  const circuit = await sdk.loadCircuit('disclose');
  // Fixed keys of the vector: public on purpose. Never deposit to a note made from them.
  const CODE = 424242n;
  const notes = [
    { pool: pool100, spendKey: 1001n, viewKey: 2001n, leafIndex: 7, depositTime: 1794300000, withdrawn: false, label: 'Invoice 17' },
    { pool: pool1, spendKey: 1002n, viewKey: 2002n, leafIndex: 9, depositTime: 1794300100, withdrawn: true, withKeys: true, label: 'Refund\nline two' },
    { pool: pool1, spendKey: 1003n, viewKey: 2003n, leafIndex: 3, depositTime: 1794200000, withdrawn: true },
  ];
  const rep = await sdk.buildReport({ net, auditorNonce: CODE, notes, circuit, created: '2026-11-12T00:00:00.000Z' });
  ok('buildReport(): type, version 1, chain, verifier, code, items sorted by deposit time, totals', rep.type === 'latheon-disclosure-report' && rep.version === 1 && rep.chainId === net.chainId && rep.verifierAddress === net.discloseVerifier && rep.auditorNonce === '424242' &&
    rep.items.map((x) => x.leafIndex).join() === '3,7,9' && rep.totals.notes === 3 && rep.totals.deposited === '102 LTH' && rep.totals.withdrawn === 2, rep.totals.deposited);
  ok('buildReport(): keys only where asked and withdrawn; label cleaned (line break to space); every proof carries [commitment, tag, code]',
    rep.items.filter((x) => x.keys).length === 1 && rep.items[2].keys.spendKey === '1002' && rep.items[2].label === 'Refund line two' && rep.items[0].label === undefined &&
    rep.items.every((x) => x.proof.pubSignals.length === 3 && BigInt(x.proof.pubSignals[0]).toString() === x.commitment && BigInt(x.proof.pubSignals[2]) === CODE));
  ok('buildReport() refuses the keys of an unspent note, a repeated note, an empty list and more than 500 notes',
    await rejects(() => sdk.buildReport({ net, auditorNonce: CODE, circuit, notes: [Object.assign({}, notes[0], { withKeys: true })] }), /only for a withdrawn note/) &&
    await rejects(() => sdk.buildReport({ net, auditorNonce: CODE, circuit, notes: [notes[0], notes[0]] }), /twice/) &&
    await rejects(() => sdk.buildReport({ net, auditorNonce: CODE, circuit, notes: [] }), /1 to 500/) &&
    await rejects(() => sdk.buildReport({ net, auditorNonce: CODE, circuit, notes: new Array(501).fill(notes[0]) }), /1 to 500/));

  const v = await sdk.verifyReport(rep, { circuit, expectedNonce: CODE });
  ok('verifyReport(): a fresh report passes with the issued code; 3 of 3 count; total 102 LTH; keys match and give the nullifier hash', v.ok && !v.codeFromFile && v.counted === 3 && v.total === '102 LTH' && v.items[2].keys === 'match' && /^\d+$/.test(v.items[2].nullifierHash) && v.items[2].tagMatches === true && v.notChecked.length === 4);
  const vNo = await sdk.verifyReport(rep, { circuit });
  ok('verifyReport() without the issued code uses the one in the file and says so', vNo.ok && vNo.codeFromFile === true);
  const vWrong = await sdk.verifyReport(rep, { circuit, expectedNonce: 111n });
  ok('…with another auditor\'s code nothing counts (the proofs are bound to the code)', !vWrong.ok && vWrong.counted === 0 && vWrong.items.every((r) => r.proofValid && !r.codeMatches));

  const mut = async (f) => { const m = clone(rep); f(m); return sdk.verifyReport(m, { circuit, expectedNonce: CODE }); };
  let r = await mut((m) => { m.items[0].commitment = m.items[1].commitment; });
  ok('tampered: a stated commitment that is not the proven one does not count', !r.ok && r.items[0].proofValid && !r.items[0].commitmentMatches && !r.items[0].counts && r.counted === 2);
  r = await mut((m) => { m.items[1].proof.pubSignals[0] = m.items[0].proof.pubSignals[0]; });
  ok('tampered: a public signal swapped for another note\'s fails the proof', !r.ok && !r.items[1].proofValid);
  r = await mut((m) => { m.items[1].proof.pA[0] = m.items[0].proof.pA[0]; });
  ok('tampered: a changed proof point fails', !r.ok && !r.items[1].proofValid);
  r = await mut((m) => { m.items.push(clone(m.items[0])); m.totals.notes = 4; });
  ok('a repeated note counts once: the second row is marked duplicate and the total does not grow', !r.ok && r.items[3].duplicate && !r.items[3].counts && r.counted === 3 && r.total === '102 LTH');
  r = await mut((m) => { m.items[2].keys.spendKey = '999'; });
  ok('keys that do not open the commitment are reported as a mismatch (the proof itself still stands)', !r.ok && r.items[2].keys === 'mismatch' && r.items[2].proofValid && r.items[2].nullifierHash === undefined);
  r = await mut((m) => { m.items[2].keys = { spendKey: 'abc', viewKey: 5 }; });
  ok('malformed keys are reported as malformed', !r.ok && r.items[2].keys === 'malformed');
  r = await mut((m) => { m.items[0].amount = 100000; m.items[0].label = 'x'.repeat(200); });
  ok('amount, pool and label in the file are not proven: a changed amount still "counts" offline (the pool decides the amount on chain), the label is cut to 60', r.ok && r.items[0].amount === 100000 && r.items[0].label.length === 60);
  r = await mut((m) => { m.items[0].proof = { pA: [], pB: [], pC: [], pubSignals: [] }; });
  ok('a malformed proof is a failed row, not an error', !r.ok && !r.items[0].proofValid && r.items[0].commitment === null);
  ok('malformed files are refused: wrong type, version 2, no items, 501 items, a non-numeric code',
    await rejects(() => sdk.verifyReport(Object.assign(clone(rep), { type: 'x' }), { circuit }), /Not a/) && await rejects(() => sdk.verifyReport(Object.assign(clone(rep), { version: 2 }), { circuit }), /version/) &&
    await rejects(() => sdk.verifyReport(Object.assign(clone(rep), { items: [] }), { circuit }), /Malformed/) && await rejects(() => sdk.verifyReport(Object.assign(clone(rep), { items: new Array(501).fill(rep.items[0]) }), { circuit }), /Malformed/) &&
    await rejects(() => sdk.verifyReport(Object.assign(clone(rep), { auditorNonce: '0x1' }), { circuit }), /Malformed/));

  // ---- committed vectors
  const vecFile = path.join(VEC, 'valid-v1.json');
  if (process.env.UPDATE_VECTORS) { fs.mkdirSync(VEC, { recursive: true }); fs.writeFileSync(vecFile, JSON.stringify(rep, null, 1) + '\n'); console.log('vector written: ' + vecFile); }
  const vec = JSON.parse(fs.readFileSync(vecFile, 'utf8'));
  const vv = await sdk.verifyReport(vec, { circuit, expectedNonce: CODE });
  ok('vector valid-v1.json (made by this SDK): passes, 3 notes, 102 LTH, code 424242', vv.ok && vv.counted === 3 && vv.total === '102 LTH' && vec.auditorNonce === '424242');
  const demoFile = path.join(VEC, 'demo-built-v1.json');
  if (fs.existsSync(demoFile)) {
    const dv = JSON.parse(fs.readFileSync(demoFile, 'utf8'));
    const dr = await sdk.verifyReport(dv, { circuit, expectedNonce: BigInt(dv.auditorNonce) });
    ok('vector demo-built-v1.json (made by the demo in the browser test): every row counts and every key set matches', dr.ok && dr.counted === dv.items.length && dr.items.filter((x) => x.keys === 'match').length === dv.items.filter((x) => x.keys).length, dr.counted + ' rows, ' + dr.total);
  } else ok('vector demo-built-v1.json is present', false, 'missing');

  console.log(fails ? `\n${fails} of ${n} FAILED` : `\nALL ${n} CHECKS PASSED`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
