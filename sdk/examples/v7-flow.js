/**
 * V7 flow on the Latheon test chain, end to end with the SDK:
 *   1. deposit any amount through the router under one master key (161 LTH = 100 + 50 + 10 + 1)
 *   2. find the notes of that master key
 *   3. withdraw an exact amount to a fresh address, in one withdrawMany, through the network's relayer
 *   4. (single pool) deposit one note and withdraw it from your own wallet
 *
 * Addresses come from ../deployments.json. Needs LTH on the Latheon test chain (faucet: docs/testnet.md) and the
 * circuit files: from circuits/build in this repository, or downloaded from the pinned commit with { download: true }.
 *
 *   PRIVATE_KEY=0x... node examples/v7-flow.js            (LATHEON_RPC_URL overrides the RPC in deployments.json)
 */
const { ethers } = require('ethers');
const sdk = require('../src/index');

async function main() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) { console.log('Reference example. Set PRIVATE_KEY (a wallet with LTH on the Latheon test chain) to run it.'); return; }

  const reg = sdk.loadDeployments();
  const router = sdk.listRouters(reg, { depositable: true })[0];          // the V7 LTH router
  const provider = new ethers.JsonRpcProvider(process.env.LATHEON_RPC_URL || router.net.rpcUrl, router.net.chainId, { staticNetwork: true });
  const signer = new ethers.Wallet(pk, provider);
  console.log('Wallet', await signer.getAddress(), 'on', router.net.name, '· router', router.id, router.address);

  const circuit = await sdk.loadCircuit('v7', { download: true });       // withdraw_v5, SHA-256 checked

  // 1. deposit 161 LTH -> 4 notes
  const amount = sdk.toUnits(router, '161');
  console.log('Plan:', sdk.planDeposit(router, amount).notes.map((p) => p.amount + ' ' + p.token).join(' + '));
  const dep = await sdk.depositAny(signer, router, amount);
  console.log('Deposited in', dep.txHash);
  console.log('MASTER KEY (save it; it is the only way to withdraw):', dep.masterKey);

  // 2. the notes of the master key
  const found = await sdk.findNotes(provider, router, dep.masterKey);
  console.log('Notes:', found.notes.map((n) => n.value + (n.spent ? ' (spent)' : '')).join(', '), '· unspent total', sdk.fromUnits(router, found.total), router.token);

  // 3. withdraw 111 LTH (100 + 10 + 1) to a fresh address through the relayer: no gas, no wallet in the transaction
  const recipient = ethers.Wallet.createRandom().address;
  const out = await sdk.withdrawByAmount(provider, router, dep.masterKey, 111, recipient, { circuit, viaRelayer: true, notes: found, log: console.log });
  console.log('Withdrawn 111 LTH to', recipient, 'in', out.txHashes.join(', '));

  // 4. one fixed pool: deposit one note of 10 LTH, withdraw it from this wallet (use another wallet in practice)
  const pool10 = sdk.listPools(reg, { depositable: true, amount: 10 })[0];
  const note = await sdk.deposit(signer, pool10);
  console.log('NOTE (save it):', note.note);
  const w = await sdk.withdrawNote(signer, pool10, note.note, ethers.Wallet.createRandom().address, { circuit, log: console.log });
  console.log('Withdrawn in', w.txHash);
}

main().catch((e) => { console.error('Error:', e.shortMessage || e.message); process.exit(1); });
