#!/usr/bin/env node
'use strict';
/*
 * Read-only: what the Latheon test chain's contracts on the parent chain say about getting a transaction in without
 * the sequencer (the delayed inbox and force inclusion). Sends nothing, needs no key and no packages.
 *
 *   node tools/force-inclusion-params.js
 *
 * It reads sdk/deployments.json (networks.latheon-testnet.bridge) and asks the parent chain's RPC:
 *   Bridge.sequencerInbox(), delayedMessageCount(), sequencerMessageCount(), nativeToken()
 *   SequencerInbox.maxTimeVariation() -> delayBlocks, futureBlocks, delaySeconds, futureSeconds
 *   SequencerInbox.totalDelayedMessagesRead(), isDelayBufferable() (absent on older versions)
 *   Inbox.allowListEnabled(), Inbox.paused()
 *   Rollup.confirmPeriodBlocks()
 *   SequencerInbox.buffer() when the delay buffer is on; Rollup.validatorWhitelistDisabled(), validatorCount()
 * A delayed message can be forced in by anyone once BOTH delayBlocks and delaySeconds have passed since it was sent.
 */
const path = require('path');
const reg = require(path.resolve(__dirname, '..', 'sdk', 'deployments.json'));
const b = reg.networks['latheon-testnet'].bridge;
const SEL = { sequencerInbox: '0xee35f327', delayedMessageCount: '0xeca067ad', sequencerMessageCount: '0x0084120c', maxTimeVariation: '0xebea461d',
  totalDelayedMessagesRead: '0x7fa3a40e', isDelayBufferable: '0x4b678a66', allowListEnabled: '0x22bd5c1c', paused: '0x5c975abb',
  confirmPeriodBlocks: '0x2e7acfa6', nativeToken: '0xe1758bd8', buffer: '0xedaafe20', validatorWhitelistDisabled: '0x12ab3d3b',
  forceInclusionDeadline: '0xdd44e6e0', validatorCount: '0x0f43a677' };

async function rpc(method, params) {
  const r = await fetch(b.parentRpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
  return j.result;
}
const call = (to, name) => rpc('eth_call', [{ to, data: SEL[name] }, 'latest']);
const words = (hex) => (hex.slice(2).match(/.{64}/g) || []).map((w) => BigInt('0x' + w));
const addr = (hex) => '0x' + hex.slice(-40);
const tryCall = async (to, name) => { try { return await call(to, name); } catch (e) { return null; } };
const dur = (s) => { s = Number(s); const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return (h ? h + ' h ' : '') + m + ' min'; };

(async () => {
  const chainId = parseInt(await rpc('eth_chainId', []), 16);
  console.log(`parent chain: ${b.parentName} (chain id ${chainId}${chainId === b.parentChainId ? '' : ', EXPECTED ' + b.parentChainId})`);
  console.log('bridge   ' + b.bridge + '\ninbox    ' + b.inbox + '\nrollup   ' + b.rollup);
  const seqInbox = addr(await call(b.bridge, 'sequencerInbox'));
  console.log('sequencer inbox ' + seqInbox);
  const [delayBlocks, futureBlocks, delaySeconds, futureSeconds] = words(await call(seqInbox, 'maxTimeVariation'));
  console.log(`\nmaxTimeVariation: delayBlocks ${delayBlocks}, futureBlocks ${futureBlocks}, delaySeconds ${delaySeconds} (${dur(delaySeconds)}), futureSeconds ${futureSeconds}`);
  const buf = await tryCall(seqInbox, 'isDelayBufferable');
  console.log('delay buffer (shortens the delay after repeated sequencer delays): ' + (buf === null ? 'function not present' : (words(buf)[0] ? 'on' : 'off')));
  const bs = buf !== null && words(buf)[0] ? await tryCall(seqInbox, 'buffer') : null;
  if (bs) { const [bufferBlocks, max, threshold, prevBlockNumber, replenish, prevSequenced] = words(bs);
    console.log(`  buffer: ${bufferBlocks} blocks now (max ${max}, threshold ${threshold}, replenish ${replenish} basis points, last delayed message read at block ${prevSequenced}, previous at ${prevBlockNumber})`);
    console.log(`  => a message sent now can be forced in after min(delayBlocks, buffer) = ${bufferBlocks < delayBlocks ? bufferBlocks : delayBlocks} blocks, about ${dur(Number(bufferBlocks < delayBlocks ? bufferBlocks : delayBlocks) * 12)} at 12 s per block`); }
  const delayed = words(await call(b.bridge, 'delayedMessageCount'))[0], read = words(await call(seqInbox, 'totalDelayedMessagesRead'))[0];
  console.log(`delayed messages sent ${delayed}, already included by the sequencer ${read}, waiting ${delayed - read}`);
  console.log('sequencer batches posted: ' + words(await call(b.bridge, 'sequencerMessageCount'))[0]);
  const al = await tryCall(b.inbox, 'allowListEnabled'), paused = await tryCall(b.inbox, 'paused');
  console.log('inbox allow list: ' + (al === null ? 'function not present' : (words(al)[0] ? 'ON (only listed addresses may send)' : 'off (anyone may send)')));
  console.log('inbox paused: ' + (paused === null ? 'function not present' : (words(paused)[0] ? 'YES' : 'no')));
  const nt = await tryCall(b.bridge, 'nativeToken');
  console.log('fee token on the parent chain: ' + (nt === null ? 'none (ETH)' : addr(nt)) + (b.token ? ' (registry: ' + b.token + ')' : ''));
  const cp = await tryCall(b.rollup, 'confirmPeriodBlocks');
  console.log('rollup confirm period: ' + (cp === null ? 'not readable' : words(cp)[0] + ' blocks'));
  const wl = await tryCall(b.rollup, 'validatorWhitelistDisabled'), vc = await tryCall(b.rollup, 'validatorCount');
  console.log('validator whitelist: ' + (wl === null ? 'not readable' : (words(wl)[0] ? 'DISABLED (anyone may validate)' : 'on (only listed validators may post and confirm assertions)')) + (vc === null ? '' : ', validators staked: ' + words(vc)[0]));
  const head = await rpc('eth_getBlockByNumber', ['latest', false]);
  console.log(`\nparent head: block ${parseInt(head.number, 16)}, L1 block number seen by contracts ${head.l1BlockNumber ? parseInt(head.l1BlockNumber, 16) : 'n/a'}, time ${new Date(parseInt(head.timestamp, 16) * 1000).toISOString()}`);
  console.log('\nRead-only, nothing was sent.');
})().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });
