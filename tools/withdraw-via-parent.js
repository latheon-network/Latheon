#!/usr/bin/env node
'use strict';
/*
 * Withdraws one note from a V7 pool on the Latheon test chain WITHOUT handing the transaction to the chain's RPC or to
 * the relayer: the signed transaction is sent to the chain's Inbox contract on the parent chain (Arbitrum Sepolia), the
 * "delayed inbox", from where the sequencer has to pick it up. It measures how long that takes.
 *
 * What this shows and what it does not:
 *   - shows: our RPC and our relayer refusing a transaction cannot stop a withdrawal; to stop it the operator would have
 *     to stop reading the parent chain altogether;
 *   - does not show: a withdrawal with the sequencer stopped (force inclusion is possible only 96 hours after the
 *     message was sent, see tools/force-inclusion-params.js), nor an exit to the parent chain without our validator;
 *   - reads still go to the chain's RPC (the deposits for the Merkle path, the nonce, the fee), or to your own node:
 *     set LATHEON_RPC_URL.
 *
 * Needs: `npm ci` in sdk/ once; a throwaway wallet with a little LTH on the Latheon test chain (gas of the withdrawal)
 * and a little ETH on Arbitrum Sepolia (gas of the Inbox call; the two keys may be one); a note of a V7 pool.
 *
 *   node tools/withdraw-via-parent.js RECIPIENT            dry run: builds and signs everything, sends nothing
 *   node tools/withdraw-via-parent.js RECIPIENT --send     sends the message to the Inbox and waits for the withdrawal
 *
 * The note and the keys are asked for with hidden input; they are not written anywhere. Testnet only.
 */
const path = require('path');
const readline = require('readline');
const sdkDir = path.resolve(__dirname, '..', 'sdk');
let ethers, sdk;
try { ({ ethers } = require(path.join(sdkDir, 'node_modules', 'ethers'))); sdk = require(path.join(sdkDir, 'src', 'index.js')); }
catch (e) { console.error('Run "npm ci" in the sdk folder first (' + e.message.split('\n')[0] + ')'); process.exit(1); }

const INBOX_ABI = ['function sendL2Message(bytes messageData) returns (uint256)'];
const L2_SIGNED_TX = '0x04';   // Arbitrum L2 message kind: a signed transaction

/**
 * A wallet for the Latheon chain whose sendTransaction() does not use the chain's RPC to submit: it signs the
 * transaction and hands it to `submit(messageData)` (the parent chain's Inbox), then waits until the chain has it.
 * opts: { submit, dryRun, log, pollMs, timeoutMs, onSubmitted }
 */
function viaParentWallet(key, provider, opts) {
  const w = new ethers.Wallet(key, provider);
  const log = opts.log || (() => {});
  w.sendTransaction = async function (tx) {
    const pop = await this.populateTransaction(tx);   // nonce, gas and fee are READ from the chain's RPC
    delete pop.from;
    const raw = await this.signTransaction(pop);
    const hash = ethers.keccak256(raw);
    const message = ethers.concat([L2_SIGNED_TX, raw]);
    log(`signed withdrawal: hash ${hash}, to ${pop.to}, nonce ${pop.nonce}, gas limit ${pop.gasLimit}, ${ethers.dataLength(raw)} bytes`);
    if (opts.dryRun) { const e = new Error('dry run'); e.dryRun = { hash, message, tx: pop }; throw e; }
    const sent = await opts.submit(message);
    if (opts.onSubmitted) opts.onSubmitted(sent, hash);
    const t0 = Date.now(), timeoutMs = opts.timeoutMs || 3600e3;
    for (;;) {
      const rc = await provider.getTransactionReceipt(hash).catch(() => null);
      if (rc) return provider.getTransaction(hash);
      if (Date.now() - t0 > timeoutMs) throw new Error('The chain has not included ' + hash + ' after ' + Math.round(timeoutMs / 60000) + ' min. It is still in the delayed inbox; do not send it again, check it later on the explorer.');
      await new Promise((r) => setTimeout(r, opts.pollMs || 5000));
    }
  };
  return w;
}

function ask(question, hidden) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(question); };
    rl.question(question, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(a.trim()); });
  });
}

// A note pasted from a wrapped text arrives as several lines: collect them until an empty line, drop all whitespace.
function askNote(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = () => {};
    process.stdout.write(question);
    const parts = [];
    rl.on('line', (l) => { if (l.trim() === '' && parts.length) { rl.close(); process.stdout.write('\n'); resolve(parts.join('').replace(/\s+/g, '')); } else if (l.trim() !== '') parts.push(l); });
  });
}

async function main() {
  const args = process.argv.slice(2), SEND = args.includes('--send');
  const recipientArg = args.find((a) => !a.startsWith('--'));
  if (!recipientArg || !ethers.isAddress(recipientArg)) { console.log('Usage: node tools/withdraw-via-parent.js RECIPIENT [--send]'); process.exit(2); }
  const recipient = ethers.getAddress(recipientArg);

  const reg = sdk.loadDeployments();
  const noteText = await askNote('Note (hidden; paste it, then press Enter twice): ');
  const note = sdk.decodeNote(noteText);
  const pool = sdk.listPools(reg).find((p) => p.address.toLowerCase() === note.address.toLowerCase() && p.net.chainId === note.chainId);
  if (!pool) throw new Error('The note is for a pool that is not in sdk/deployments.json');
  const net = pool.net, b = net.bridge;
  if (!b || !b.inbox || !b.parentRpcUrl) throw new Error('No parent-chain bridge data for ' + net.name);
  if (pool.frozen || pool.forgeable) console.log('NOTE: this pool is marked frozen/forgeable in the registry.');

  const child = new ethers.JsonRpcProvider(process.env.LATHEON_RPC_URL || net.rpcUrl, net.chainId, { staticNetwork: true });
  const parent = new ethers.JsonRpcProvider(process.env.PARENT_RPC_URL || b.parentRpcUrl, b.parentChainId, { staticNetwork: true });
  const childKey = await ask(`Key of the wallet that pays the withdrawal's gas on ${net.name} (hidden): `, true);
  const parentKeyIn = await ask(`Key of the wallet that pays the Inbox call on ${b.parentName} (hidden; Enter = the same key): `, true);
  const parentWallet = new ethers.Wallet(parentKeyIn || childKey, parent);
  const inbox = new ethers.Contract(b.inbox, INBOX_ABI, parentWallet);

  const childAddr = new ethers.Wallet(childKey).address;
  const [cb, pb] = await Promise.all([child.getBalance(childAddr), parent.getBalance(parentWallet.address)]);
  console.log(`\n${net.name}: wallet ${childAddr}, ${ethers.formatEther(cb)} ${net.nativeCurrency ? net.nativeCurrency.symbol : ''}`);
  console.log(`${b.parentName}: wallet ${parentWallet.address}, ${ethers.formatEther(pb)} ETH; Inbox ${b.inbox}`);
  console.log(`pool ${pool.id} ${pool.address}; recipient ${recipient}\n`);
  if (cb === 0n) throw new Error('The first wallet has no gas money on ' + net.name);
  if (pb === 0n) throw new Error('The second wallet has no ETH on ' + b.parentName);

  const times = {};
  const wallet = viaParentWallet(childKey, child, {
    dryRun: !SEND, log: console.log,
    submit: async (message) => {
      const gas = await inbox.sendL2Message.estimateGas(message);
      console.log(`sending the message to the Inbox on ${b.parentName} (${ethers.dataLength(message)} bytes, about ${gas} gas)…`);
      const tx = await inbox.sendL2Message(message);
      const rc = await tx.wait();
      const blk = await parent.getBlock(rc.blockNumber);
      times.parentTx = tx.hash; times.parentTime = blk.timestamp; times.wall = Date.now();
      console.log(`in the delayed inbox: ${tx.hash} (block ${rc.blockNumber}, ${new Date(blk.timestamp * 1000).toISOString()}). Waiting for ${net.name} to include the withdrawal…`);
      return tx;
    },
  });

  console.log('loading the circuit and building the proof (reads go to ' + (process.env.LATHEON_RPC_URL ? 'LATHEON_RPC_URL' : net.rpcUrl) + ')…');
  const circuit = await sdk.loadCircuit(pool.circuit || 'v7', { download: true });
  try {
    const out = await sdk.withdrawNote(wallet, pool, note, recipient, { circuit, log: console.log });
    const rc = await child.getTransactionReceipt(out.txHash), blk = await child.getBlock(rc.blockNumber);
    console.log(`\nWITHDRAWN on ${net.name}: ${out.txHash} (block ${rc.blockNumber}, ${new Date(blk.timestamp * 1000).toISOString()}), status ${rc.status}`);
    console.log(`from the Inbox transaction to the withdrawal: ${blk.timestamp - times.parentTime} s by block timestamps, ${Math.round((Date.now() - times.wall) / 1000)} s as seen from here`);
    console.log(`Inbox transaction on ${b.parentName}: ${times.parentTx}`);
    console.log('The withdrawal was never sent to the chain\'s RPC or to the relayer.');
  } catch (e) {
    if (e.dryRun || (e.cause && e.cause.dryRun)) {
      const d = e.dryRun || e.cause.dryRun;
      const gas = await inbox.sendL2Message.estimateGas(d.message).catch((x) => 'estimate failed: ' + (x.shortMessage || x.message));
      console.log(`\nDRY RUN, nothing sent. The proof passed the pool's own checks. Would call Inbox.sendL2Message with ${ethers.dataLength(d.message)} bytes (gas on ${b.parentName}: ${gas}).`);
      console.log('Run again with --send to do it.');
      return;
    }
    throw e;
  }
}

if (require.main === module) main().catch((e) => { console.error('Error: ' + (e.shortMessage || e.message)); process.exit(1); });
module.exports = { viaParentWallet, L2_SIGNED_TX, askNote };