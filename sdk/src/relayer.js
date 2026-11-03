'use strict';
/*
 * The network's withdrawal relayer (deployments.json: networks.<id>.relayer; GET /status, POST /withdraw,
 * POST /withdrawMany). It sends the withdrawal from its own address and pays the gas, so no wallet is needed and the
 * withdrawing wallet does not appear on chain. It cannot change the recipient: the proof is bound to it. It accepts
 * only the pools and routers of deployments.json, simulates every request first, and (today) takes no fee.
 */
const { ZeroAddress } = require('ethers');

const relayFor = (net) => (net && net.relayer ? String(net.relayer).replace(/\/$/, '') : null);
const hasRelayer = (net) => !!relayFor(net);

const json = (body) => JSON.stringify(body, (k, v) => (typeof v === 'bigint' ? v.toString() : v));

async function relayPost(net, route, body, fetchImpl) {
  const base = relayFor(net);
  if (!base) throw new Error('This network lists no relayer in deployments.json');
  const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!f) throw new Error('fetch is not available: use Node 18+ or pass a fetch implementation');
  let r;
  try { r = await f(base + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: json(body) }); }
  catch (e) { throw new Error('The relayer did not answer (' + e.message + '); the same proof can be sent from any wallet'); }
  let j = {}; try { j = await r.json(); } catch (e) { /* no JSON body */ }
  if (!r.ok || !j.tx) throw new Error('The relayer refused: ' + (j.error || ('HTTP ' + r.status)));
  return j;   // { tx, gasUsed? }
}

/** GET /status of the network's relayer (its address, limits, accepted contracts; shape defined by the relayer). */
async function relayStatus(net, fetchImpl) {
  const base = relayFor(net);
  if (!base) throw new Error('This network lists no relayer in deployments.json');
  const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!f) throw new Error('fetch is not available: use Node 18+ or pass a fetch implementation');
  const r = await f(base + '/status');
  if (!r.ok) throw new Error('relayer status: HTTP ' + r.status);
  return r.json();
}

/**
 * Sends one pool withdrawal through the relayer.
 * @param {object} pool            registry pool
 * @param {object} proof           { pA, pB, pC, pubSignals } from proveWithdraw()
 * @param {string} recipient
 * @param {object} [opts]          { relayer, fee } (V6/V7; defaults: zero address, 0), fetch
 * @returns {Promise<{tx: string, gasUsed?: string}>}
 */
async function relayWithdraw(pool, proof, recipient, opts = {}) {
  const body = { pool: pool.address, pA: proof.pA, pB: proof.pB, pC: proof.pC, root: proof.pubSignals[0], nullifierHash: proof.pubSignals[1], recipient };
  if (pool.feeVersion) { body.relayer = opts.relayer || ZeroAddress; body.fee = (opts.fee !== undefined ? BigInt(opts.fee) : 0n).toString(); }
  return relayPost(pool.net, '/withdraw', body, opts.fetch);
}

/**
 * Sends one withdrawMany batch (items as buildWithdrawManyItem() makes them, at most MAX_WITHDRAWALS) through the relayer.
 */
async function relayWithdrawMany(router, items, recipient, opts = {}) {
  const body = { router: router.address, items, recipient };
  if (router.feeVersion) body.relayer = opts.relayer || ZeroAddress;
  return relayPost(router.net, '/withdrawMany', body, opts.fetch);
}

module.exports = { relayFor, hasRelayer, relayStatus, relayWithdraw, relayWithdrawMany, relayPost };
