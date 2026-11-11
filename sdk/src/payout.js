'use strict';
/*
 * Payouts to a list of recipients (payroll, vendors) through a V7 router, with the contracts as they are.
 *
 *   planPayout(router, payees)              split every amount on its own and pack all notes into router deposits
 *   depositPayout(signer, router, plan)     make those deposits; returns a payout record (SECRET: it holds master keys)
 *   payOut(signerOrProvider, router, record) one withdrawMany per recipient (16 notes per batch), resumable
 *
 * Why every amount is split on its own: the router splits a deposit greedily (100 / 50 / 10 / 1), and the greedy split
 * of a total does not divide back into the payees' amounts (10 x 1,234 = 12,340 -> 123 x 100 + 4 x 10, no 1s). So the
 * plan takes the union of the payees' own splits and packs it into several router deposits whose greedy split is
 * exactly that union (each under its own master key, at most 32 notes).
 *
 * Privacy, stated plainly: amounts are public. A router deposit shows its amount and sender; each payee's withdrawal
 * shows the amount received. With few users and unusual amounts a payout can be matched to its payer by amount and
 * time. Spreading the payouts over time (opts.delayMs) weakens this; only hidden amounts would remove it.
 */
const { getAddress } = require('ethers');
const { MAX_NOTES } = require('./constants');
const dist = require('../distribution');
const { parseMasterKey } = require('./notes');
const { fetchDeposits } = require('./merkleTree');
const { loadCircuit } = require('./prove');
const { providerOf } = require('./pool');
const { depositAny, findNotes, withdrawByAmount, checkRouterOnChain } = require('./router');

const RECORD_KIND = 'latheon-payout';
const RECORD_VERSION = 1;
const sumCounts = (counts, denominations) => counts.reduce((s, c, i) => s + c * denominations[i], 0n);
const noteCount = (counts) => counts.reduce((s, c) => s + c, 0n);

/** Packs note counts into greedy-exact router deposits (shared with the demo: distribution.js packChunks). */
const packChunks = (counts, denominations, maxNotes = MAX_NOTES) => dist.packChunks(counts, denominations, maxNotes);

/**
 * Plans a payout. payees: [{ recipient, amount }], amount in base units of the router's token (sdk.toUnits).
 * @returns {{payees: object[], counts: bigint[], amount: bigint, notes: bigint, chunks: object[]}}
 *   payees[i] = { recipient, amount, counts, notes, tokens (whole tokens, for withdrawByAmount) }
 */
function planPayout(router, payees, opts = {}) {
  if (!Array.isArray(payees) || payees.length === 0) throw new Error('No payees');
  const den = router.denominations;
  const unit = den[den.length - 1];
  const list = payees.map((p, i) => {
    let recipient;
    try { recipient = getAddress(p.recipient); } catch (e) { throw new Error(`Payee ${i + 1}: bad address ${p.recipient}`); }
    const amount = BigInt(p.amount);
    if (amount <= 0n) throw new Error(`Payee ${i + 1}: amount must be positive`);
    if (amount % unit !== 0n) throw new Error(`Payee ${i + 1}: amount is not a multiple of the smallest note`);
    const { counts, total } = dist.canonicalSplit(amount, den);
    return { recipient, amount, counts, notes: total, tokens: Number(amount / unit) * Number(router.pools[den.length - 1].amount) };
  });
  const counts = den.map((_, i) => list.reduce((s, p) => s + p.counts[i], 0n));
  const chunks = packChunks(counts, den, opts.maxNotes || MAX_NOTES);
  return { payees: list, counts, amount: sumCounts(counts, den), notes: noteCount(counts), chunks };
}

/**
 * Makes the deposits of a plan, one router deposit per chunk, each under a fresh master key.
 * @returns {Promise<object>} the payout record: { kind, version, chainId, router, masterKeys, minBlock, depositTxs,
 *   payees: [{ recipient, amount, counts }] } (amounts as decimal strings). It holds the master keys: keep it secret.
 */
async function depositPayout(signer, router, plan, opts = {}) {
  const log = opts.log || (() => {});
  if (!opts.skipChecks) await checkRouterOnChain(signer.provider, router, plan.chunks[0].amount);
  const masterKeys = [], depositTxs = [];
  let minBlock = 0;
  for (let i = 0; i < plan.chunks.length; i++) {
    const d = await depositAny(signer, router, plan.chunks[i].amount, { skipChecks: true });
    masterKeys.push(d.masterKey); depositTxs.push(d.txHash);
    if (d.receipt.blockNumber > minBlock) minBlock = d.receipt.blockNumber;
    log(`Deposit ${i + 1}/${plan.chunks.length}: ${plan.chunks[i].total} notes, tx ${d.txHash}`);
    if (opts.onDeposit) opts.onDeposit(i + 1, plan.chunks.length, d);
  }
  return {
    kind: RECORD_KIND, version: RECORD_VERSION, chainId: router.net.chainId, router: router.address, masterKeys, minBlock, depositTxs,
    payees: plan.payees.map((p) => ({ recipient: p.recipient, amount: p.amount.toString(), counts: p.counts.map(String) })),
  };
}

/** Checks a payout record's shape and that it belongs to `router`. */
function checkRecord(router, record) {
  if (!record || record.kind !== RECORD_KIND || record.version !== RECORD_VERSION) throw new Error('Not a Latheon payout record (version 1)');
  if (record.chainId !== router.net.chainId || getAddress(record.router) !== getAddress(router.address)) throw new Error(`This payout belongs to router ${record.router} on chain ${record.chainId}`);
  if (!Array.isArray(record.masterKeys) || !record.masterKeys.length || !Array.isArray(record.payees) || !record.payees.length) throw new Error('Payout record without master keys or payees');
  record.masterKeys.forEach((m) => { const mk = parseMasterKey(m); if (mk.chainId !== router.net.chainId || getAddress(mk.router) !== getAddress(router.address)) throw new Error('A master key of this payout belongs to another router'); });
  return true;
}

/**
 * Assigns the payout's notes to its payees, deterministically (by pool, then master key, then index; shared with the
 * demo: distribution.js assignNotes). The same record always gives the same assignment, so a payout can be resumed.
 * @param {object[]} notes  findNotes() notes of all master keys, each with `.mk` (index of its master key)
 */
function assignPayoutNotes(record, notes, poolCount) {
  try { return dist.assignNotes(record.payees.map((p) => p.counts), notes, poolCount); }
  catch (e) { throw new Error(e.message + ' (deposits not found yet?)'); }
}

/**
 * Pays every payee of a record: for each, its assigned notes go to its recipient (withdrawByAmount: one withdrawMany
 * per 16 notes), from the signer or (opts.viaRelayer) through the relayer. Payees whose notes are all spent are
 * skipped ('already paid'); a payee interrupted between batches gets the rest ('resumed').
 * (Delayed sending, opts.delay of withdrawByAmount, is not passed on here: a payee would look unpaid until the relayer sends.)
 * @param {object} [opts]  { viaRelayer, relayer, fee, circuit, circuitOpts, scanOpts, only (payee indexes), delayMs, onPayee, log }
 * @returns {Promise<object[]>} per payee: { recipient, amount, status: 'paid' | 'already paid' | 'resumed' | 'skipped', txHashes, notes }
 */
async function payOut(signerOrProvider, router, record, opts = {}) {
  checkRecord(router, record);
  const provider = providerOf(signerOrProvider);
  if (!provider) throw new Error('payOut needs a Signer with a provider, or a Provider with opts.viaRelayer');
  const log = opts.log || (() => {});
  const circuit = opts.circuit || await loadCircuit(router.circuit, opts.circuitOpts);
  const scanOpts = Object.assign({}, opts.scanOpts, record.minBlock ? { minBlock: record.minBlock } : {});
  const deposits = await Promise.all(router.pools.map((pool) => fetchDeposits(provider, pool, scanOpts)));
  const notes = [];
  for (let m = 0; m < record.masterKeys.length; m++) {
    const f = await findNotes(provider, router, record.masterKeys[m], { deposits });
    f.notes.forEach((n) => { n.mk = m; notes.push(n); });
  }
  const assigned = assignPayoutNotes(record, notes, router.pools.length);
  const only = opts.only ? new Set(opts.only) : null;
  const results = [];
  for (let i = 0; i < record.payees.length; i++) {
    const p = record.payees[i];
    const mine = assigned[i];
    if (only && !only.has(i)) { results.push({ recipient: p.recipient, amount: p.amount, status: 'skipped', txHashes: [], notes: mine }); continue; }
    const left = mine.filter((n) => !n.spent);
    if (!left.length) { results.push({ recipient: p.recipient, amount: p.amount, status: 'already paid', txHashes: [], notes: mine }); log(`Payee ${i + 1}: already paid`); continue; }
    if (results.some((r) => r.status === 'paid' || r.status === 'resumed') && opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    const tokens = left.reduce((s, n) => s + Number(n.value), 0);
    const w = await withdrawByAmount(signerOrProvider, router, null, tokens, p.recipient, Object.assign({}, opts, { circuit, notes: { notes: left, deposits }, log, delay: undefined }));
    const r = { recipient: p.recipient, amount: p.amount, status: left.length === mine.length ? 'paid' : 'resumed', txHashes: w.txHashes, notes: mine };
    results.push(r);
    log(`Payee ${i + 1}/${record.payees.length}: ${tokens} ${router.token} to ${p.recipient}, ${w.txHashes.length} transaction(s)`);
    if (opts.onPayee) opts.onPayee(i, r);
  }
  return results;
}

/** A payout record as JSON text (BigInt-free) and back. */
const payoutToJson = (record) => JSON.stringify(record, null, 2);
const payoutFromJson = (text) => JSON.parse(text);

module.exports = { packChunks, planPayout, depositPayout, checkRecord, assignPayoutNotes, payOut, payoutToJson, payoutFromJson, RECORD_KIND, RECORD_VERSION };
