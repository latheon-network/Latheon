'use strict';
/**
 * The disclosure report file ("latheon-disclosure-report", version 1): build it and check it without a network.
 * The format and the checking rules are specified in docs/disclosure-report-format.md; the demo's report and auditor
 * tabs read and write the same file. On-chain facts (the deposit exists, the note was withdrawn and to whom) are not
 * checked here: see checkReportOnChain().
 */
const { computeCommitment, computeNullifierHash, computeDisclosureTag, isFieldElement } = require('./poseidon');
const { buildDiscloseInput, proveDisclose, verificationKeyOf } = require('./prove');
const { fetchDeposits, fetchSpent } = require('./merkleTree');

const REPORT_TYPE = 'latheon-disclosure-report', REPORT_VERSION = 1, REPORT_MAX = 500, LABEL_MAX = 60;
const snarkjs = () => require('snarkjs');

/** The user's label as stored: control characters and line breaks become spaces, trimmed, at most 60 characters. */
const cleanLabel = (v) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX);

/** "123 LTH, 4 USDG" from [{ amount, token }]. */
function sumsText(list) {
  const by = {}; for (const x of list) by[x.token] = (by[x.token] || 0) + Number(x.amount);
  return Object.entries(by).map(([k, v]) => v + ' ' + k).join(', ');
}

/** The proof as the file stores it (Solidity call data) back to the form snarkjs verifies. */
function proofFromCallData(p) {
  const d = (x) => BigInt(x).toString();
  return { proof: { pi_a: [d(p.pA[0]), d(p.pA[1]), '1'], pi_b: [[d(p.pB[0][1]), d(p.pB[0][0])], [d(p.pB[1][1]), d(p.pB[1][0])], ['1', '0']], pi_c: [d(p.pC[0]), d(p.pC[1]), '1'], protocol: 'groth16', curve: 'bn128' },
    publicSignals: p.pubSignals.map(d) };
}

/**
 * Builds a report. Offline: the caller supplies the on-chain facts of each note.
 * @param {object} a
 *   net          registry network ({ name, chainId, discloseVerifier })
 *   auditorNonce the auditor's one-time code
 *   notes        [{ pool (registry pool), spendKey, viewKey, leafIndex, depositTime, withdrawn, label?, withKeys? }]
 *                withKeys puts the note's keys in the file and is refused unless withdrawn is true: the keys of an
 *                unspent note are the money. Confirm the withdrawal on chain before asking for it.
 *   circuit      loadCircuit('disclose') result
 *   created      ISO time (default: now)
 */
async function buildReport({ net, auditorNonce, notes, circuit, created }) {
  if (!Array.isArray(notes) || !notes.length || notes.length > REPORT_MAX) throw new Error(`A report holds 1 to ${REPORT_MAX} notes`);
  const nonce = BigInt(auditorNonce);
  if (!isFieldElement(nonce)) throw new Error('The auditor code is not a field element');
  const seen = new Set(), items = [];
  for (const n of notes) {
    const sk = BigInt(n.spendKey), vk = BigInt(n.viewKey), commitment = computeCommitment(sk, vk);
    if (seen.has(commitment)) throw new Error('The same note is listed twice');
    seen.add(commitment);
    if (n.withKeys && n.withdrawn !== true) throw new Error('Keys can be added only for a withdrawn note');
    const p = await proveDisclose(buildDiscloseInput({ spendKey: sk, viewKey: vk, auditorNonce: nonce }), circuit);
    const it = { pool: n.pool.address, version: n.pool.version, token: n.pool.token, amount: n.pool.amount, commitment: commitment.toString(), leafIndex: n.leafIndex, depositTime: n.depositTime, withdrawn: !!n.withdrawn,
      proof: { pA: p.pA, pB: p.pB, pC: p.pC, pubSignals: p.pubSignals } };
    if (n.label !== undefined && cleanLabel(n.label)) it.label = cleanLabel(n.label);
    if (n.withKeys) it.keys = { spendKey: sk.toString(), viewKey: vk.toString() };
    items.push(it);
  }
  items.sort((a, b) => a.depositTime - b.depositTime || a.leafIndex - b.leafIndex);
  return { type: REPORT_TYPE, version: REPORT_VERSION, created: created || new Date().toISOString(), network: net.name, chainId: net.chainId, verifierAddress: net.discloseVerifier,
    auditorNonce: nonce.toString(), items, totals: { notes: items.length, deposited: sumsText(items), withdrawn: items.filter((x) => x.withdrawn).length } };
}

/**
 * Checks a report without a network (docs/disclosure-report-format.md, section 5, steps 1-6).
 * @param {object} report          the parsed file
 * @param {object} opts
 *   circuit | vkey   loadCircuit('disclose') result, or the disclose verification key
 *   expectedNonce    the code the auditor issued; without it the code written in the file is used and
 *                    result.codeFromFile is true (the file then proves nothing about WHO it was made for)
 * @returns {Promise<{ok: boolean, codeFromFile: boolean, nonce: string, items: object[], counted: number, total: string, notChecked: string[]}>}
 *   items[i]: { index, pool, amount, token, commitment, proofValid, commitmentMatches, codeMatches, duplicate,
 *               keys: 'none' | 'match' | 'mismatch' | 'malformed', nullifierHash?, label, counts }
 *   ok is true when every item counts (valid proof, commitment as stated, the right code, not a repeat) and no keys mismatch.
 */
async function verifyReport(report, opts = {}) {
  const b = report;
  if (!b || b.type !== REPORT_TYPE) throw new Error('Not a ' + REPORT_TYPE + ' file');
  if (b.version !== REPORT_VERSION) throw new Error('Unsupported report version ' + b.version);
  if (!Array.isArray(b.items) || !b.items.length || b.items.length > REPORT_MAX || !/^\d+$/.test(String(b.auditorNonce))) throw new Error('Malformed report');
  const vkey = opts.vkey || await verificationKeyOf(opts.circuit);
  const codeFromFile = opts.expectedNonce === undefined || opts.expectedNonce === null;
  const nonce = codeFromFile ? BigInt(b.auditorNonce) : BigInt(opts.expectedNonce);
  const seen = new Set(), items = [];
  for (let i = 0; i < b.items.length; i++) {
    const x = b.items[i] || {}, p = x.proof || {};
    const r = { index: i, pool: x.pool, amount: x.amount, token: x.token, commitment: null, proofValid: false, commitmentMatches: false, codeMatches: false, duplicate: false, keys: 'none', label: typeof x.label === 'string' ? cleanLabel(x.label) : '', counts: false };
    const shaped = Array.isArray(p.pA) && p.pA.length === 2 && Array.isArray(p.pB) && p.pB.length === 2 && Array.isArray(p.pC) && p.pC.length === 2 && Array.isArray(p.pubSignals) && p.pubSignals.length === 3;
    if (shaped) {
      try {
        const sn = proofFromCallData(p);
        r.commitment = sn.publicSignals[0];
        r.codeMatches = BigInt(sn.publicSignals[2]) === nonce;
        r.commitmentMatches = sn.publicSignals[0] === String(x.commitment);
        r.proofValid = await snarkjs().groth16.verify(vkey, sn.publicSignals, sn.proof);
      } catch (e) { r.proofValid = false; }
    }
    if (r.commitment !== null) { if (seen.has(r.commitment)) r.duplicate = true; else seen.add(r.commitment); }
    if (x.keys !== undefined) {
      try {
        const sk = BigInt(x.keys.spendKey), vk = BigInt(x.keys.viewKey);
        if (!isFieldElement(sk) || !isFieldElement(vk)) r.keys = 'malformed';
        else if (r.commitment !== null && computeCommitment(sk, vk).toString() === r.commitment) { r.keys = 'match'; r.nullifierHash = computeNullifierHash(sk).toString(); r.tagMatches = computeDisclosureTag(vk, BigInt(p.pubSignals[2])).toString() === BigInt(p.pubSignals[1]).toString(); }
        else r.keys = 'mismatch';
      } catch (e) { r.keys = 'malformed'; }
    }
    r.counts = r.proofValid && r.commitmentMatches && r.codeMatches && !r.duplicate;
    items.push(r);
  }
  const counted = items.filter((r) => r.counts);
  return { ok: counted.length === items.length && !items.some((r) => r.keys === 'mismatch' || r.keys === 'malformed'), codeFromFile, nonce: nonce.toString(), items, counted: counted.length,
    total: sumsText(counted), notChecked: ['that each commitment is a deposit in the stated pool (Deposit event)', 'that a note marked withdrawn was withdrawn, and to whom (Withdrawal event)', 'that the pools are the ones you expect', 'labels (the user\'s own text)'] };
}

/**
 * The on-chain part (section 5, steps 7-8): for every item that counted, finds its Deposit event; for items with
 * matching keys, finds the Withdrawal event of the note. Reads whole pools (fetchDeposits, fetchSpent), never one note.
 * @param {object} result   verifyReport() result (it is extended in place and returned)
 * @param {object} report   the same file
 * @param {import('ethers').Provider} provider
 * @param {object[]} pools  registry pools of the report's chain
 */
async function checkReportOnChain(result, report, provider, pools, opts = {}) {
  const byAddr = new Map(pools.map((p) => [p.address.toLowerCase(), p])), deps = new Map(), spent = new Map();
  for (const r of result.items) {
    const pool = byAddr.get(String(r.pool).toLowerCase());
    r.poolKnown = !!pool;
    if (!pool || !r.counts) continue;
    if (!deps.has(pool.address)) deps.set(pool.address, await fetchDeposits(provider, pool, opts.scanOpts));
    const d = deps.get(pool.address).find((e) => e.commitment.toString() === r.commitment);
    r.depositFound = !!d;
    if (d) { r.leafIndex = d.leafIndex; r.depositTime = d.timestamp; r.statedAmountMatchesPool = Number(report.items[r.index].amount) === Number(pool.amount) && report.items[r.index].token === pool.token; }
    if (r.keys === 'match') {
      if (!spent.has(pool.address)) spent.set(pool.address, await fetchSpent(provider, pool, opts.scanOpts));
      r.withdrawnOnChain = spent.get(pool.address).has(BigInt(r.nullifierHash));
    }
  }
  result.onChain = true;
  result.okOnChain = result.ok && result.items.every((r) => r.poolKnown && r.depositFound && r.statedAmountMatchesPool && (r.keys !== 'match' || r.withdrawnOnChain));
  return result;
}

module.exports = { REPORT_TYPE, REPORT_VERSION, REPORT_MAX, buildReport, verifyReport, checkReportOnChain, proofFromCallData, cleanLabel, sumsText };
