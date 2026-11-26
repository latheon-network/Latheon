/**
 * V8 flow on the Latheon test chain, end to end with the SDK:
 *   1. deposit 12 LTH through the V8 router under one master key (10 + 1 + 1)
 *   2. find the notes of that master key
 *   3. withdraw 11 LTH (10 + 1) to a fresh address in one withdrawMany, sent by the network's relayer
 *   4. disclosure (disclose_v2) of the note still in the pool, checked by the deployed verifier
 *   5. withdraw the last router note from this wallet to another fresh address
 *   6. one fixed pool: deposit 1 LTH, withdraw it from this wallet with a payment reference of our choosing
 *   7. receipt (disclose_link) of that note, checked by the deployed verifier; its nullifier is the one withdrawn
 *
 * Every note is withdrawn by the end. The master key and the note are not printed: they are written to
 * latheon-v8-flow-secrets.json in your home folder, so they can be recovered if a step fails. Keep that file private.
 *
 * Addresses come from ../deployments.json. Needs about 15 LTH on the Latheon test chain (faucet: docs/testnet.md) and
 * the circuit files: from circuits/build in this repository, or downloaded from the pinned commit.
 *
 *   PRIVATE_KEY=0x... node examples/v8-flow.js            (LATHEON_RPC_URL overrides the RPC in deployments.json)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ethers } = require('ethers');
const sdk = require('../src/index');

async function run({ signer, provider, registry, log = console.log, secretsFile, tx = (h) => h, wait = 0 }) {
  const results = { checks: [] };
  const check = (name, cond) => { results.checks.push({ name, ok: !!cond }); log((cond ? 'OK   ' : 'FAIL ') + name); };
  const save = (k, v) => { if (!secretsFile) return; let s = {}; try { s = JSON.parse(fs.readFileSync(secretsFile, 'utf8')); } catch (e) { /* new file */ } s[k] = v; fs.writeFileSync(secretsFile, JSON.stringify(s, null, 2), { mode: 0o600 }); };
  const pause = () => (wait ? new Promise((r) => setTimeout(r, wait)) : Promise.resolve());
  const balanceAfter = async (addr, want) => { for (let i = 0; i < 30; i++) { const b = await provider.getBalance(addr); if (b >= want) return b; await new Promise((r) => setTimeout(r, 2000)); } return provider.getBalance(addr); };
  const gasOf = async (hash) => { const r = await provider.getTransactionReceipt(hash); return r ? r.gasUsed.toString() : '?'; };

  const router = sdk.listRouters(registry, { depositable: true, version: 'v8' })[0];
  if (!router) throw new Error('No depositable V8 router in deployments.json');
  const pool1 = sdk.listPools(registry, { depositable: true, version: 'v8', amount: 1 })[0];
  const E = (n) => sdk.toUnits(router, String(n));
  log('Wallet ' + (await signer.getAddress()) + ' on ' + router.net.name + ' · V8 router ' + router.address);

  const circuit = await sdk.loadCircuit('v8', { download: true });
  const cd2 = await sdk.loadCircuit('disclose_v2', { download: true });
  const cdl = await sdk.loadCircuit('disclose_link', { download: true });
  log('Circuits: withdraw_v6, disclose_v2, disclose_link loaded and checked');

  // 1. router deposit
  const plan = sdk.planDeposit(router, E(12)).notes.map((p) => p.amount).join(' + ');
  const dep = await sdk.depositAny(signer, router, E(12));
  save('masterKey', dep.masterKey);
  results.deposit = dep.txHash;
  log('1. Router deposit 12 LTH (' + plan + ') tx ' + tx(dep.txHash) + ' · block ' + dep.receipt.blockNumber + ' · gas ' + dep.receipt.gasUsed);
  check('router deposit: 3 notes, master key names the V8 router', dep.notes.length === 3 && dep.masterKey.includes(router.address));
  await pause();

  // 2. find the notes
  const found = await sdk.findNotes(provider, router, dep.masterKey, { minBlock: dep.receipt.blockNumber });
  check('findNotes: 3 unspent notes, 12 LTH', found.unspent.length === 3 && found.total === E(12));

  // 3. 11 LTH through the relayer
  const to1 = ethers.Wallet.createRandom().address;
  const t0 = Date.now();
  const out = await sdk.withdrawByAmount(provider, router, dep.masterKey, 11, to1, { circuit, viaRelayer: true, notes: found, log: (m) => log('   ' + m) });
  results.relayed = out.txHashes;
  log('3. Relayed withdrawMany 11 LTH to ' + to1 + ' tx ' + out.txHashes.map(tx).join(', ') + ' · gas ' + (await gasOf(out.txHashes[0])) + ' · ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s from proving to answer');
  check('relayed withdrawMany: the fresh address received exactly 11 LTH', (await balanceAfter(to1, E(11))) === E(11));
  await pause();

  // 4. disclosure of the note left in the pool
  const left = await sdk.findNotes(provider, router, dep.masterKey, { minBlock: (await provider.getTransactionReceipt(out.txHashes[0])).blockNumber });
  check('findNotes afterwards: one 1-LTH note left', left.unspent.length === 1 && left.unspent[0].value === 1);
  const n = left.unspent[0];
  const nonce = BigInt(ethers.hexlify(ethers.randomBytes(6)));
  const pd = await sdk.proveDisclose(sdk.buildDiscloseInput({ spendKey: n.spendKey, viewKey: n.viewKey, auditorNonce: nonce, version: 'v8' }), cd2);
  const DV = new ethers.Contract(n.pool.discloseVerifierAddr, sdk.VERIFIER_ABI.disclose_v2, provider);
  const bad = [pd.pubSignals[0], pd.pubSignals[1], (nonce + 1n).toString()];
  let refused = false; try { refused = !(await DV.verifyProof(pd.pA, pd.pB, pd.pC, bad)); } catch (e) { refused = true; }
  check('disclose_v2 accepted by the deployed verifier ' + n.pool.discloseVerifierAddr + ' for auditor code ' + nonce + '; another code refused', (await DV.verifyProof(pd.pA, pd.pB, pd.pC, pd.pubSignals)) && refused);

  // 5. last router note from this wallet
  const to2 = ethers.Wallet.createRandom().address;
  const out2 = await sdk.withdrawByAmount(signer, router, dep.masterKey, 1, to2, { circuit, notes: left, log: (m) => log('   ' + m) });
  log('5. withdrawMany 1 LTH from the wallet to ' + to2 + ' tx ' + out2.txHashes.map(tx).join(', ') + ' · gas ' + (await gasOf(out2.txHashes[0])));
  check('wallet withdrawMany: the fresh address received exactly 1 LTH', (await balanceAfter(to2, E(1))) === E(1));
  await pause();

  // 6. one fixed pool with a payment reference
  const note = await sdk.deposit(signer, pool1);
  save('note', note.note);
  log('6. Pool deposit 1 LTH tx ' + tx(note.txHash) + ' · leaf ' + note.leafIndex + ' · gas ' + note.receipt.gasUsed);
  await pause();
  const ref = ethers.id('latheon-sdk-v8-flow invoice ' + new Date().toISOString());
  const to3 = ethers.Wallet.createRandom().address;
  const w = await sdk.withdrawNote(signer, pool1, note.note, to3, { circuit, paymentRef: ref, minBlock: note.receipt.blockNumber, log: (m) => log('   ' + m) });
  const ev = w.receipt.logs.map((l) => { try { return new ethers.Interface(sdk.POOL_ABI.v8).parseLog(l); } catch (e) { return null; } }).find((e) => e && e.name === 'Withdrawal');
  log('   withdrawal tx ' + tx(w.txHash) + ' · gas ' + w.receipt.gasUsed + ' · payment reference ' + ref);
  check('pool withdrawal: exactly 1 LTH to the fresh address, our payment reference in the Withdrawal event', (await balanceAfter(to3, E(1))) === E(1) && ev && ev.args.paymentRef === ref);

  // 7. receipt of that note
  const pl = await sdk.proveDiscloseLink(sdk.buildDiscloseLinkInput({ spendKey: note.spendKey, viewKey: note.viewKey, ctx: sdk.contextOf(pool1), auditorNonce: nonce }), cdl);
  const DL = new ethers.Contract(pool1.discloseLinkVerifierAddr, sdk.VERIFIER_ABI.disclose_link, provider);
  check('disclose_link accepted by the deployed verifier ' + pool1.discloseLinkVerifierAddr + '; its nullifier is the one in the Withdrawal event (a receipt)', (await DL.verifyProof(pl.pA, pl.pB, pl.pC, pl.pubSignals)) && ev && BigInt(pl.pubSignals[1]) === BigInt(ev.args.nullifierHash));

  const failed = results.checks.filter((c) => !c.ok).length;
  log(failed ? '\n' + failed + ' of ' + results.checks.length + ' checks FAILED' : '\nALL ' + results.checks.length + ' CHECKS PASSED · every note withdrawn');
  results.failed = failed;
  return results;
}

async function main() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) { console.log('Reference example. Set PRIVATE_KEY (a wallet with LTH on the Latheon test chain) to run it.'); return; }
  const registry = sdk.loadDeployments();
  const net = sdk.listRouters(registry, { depositable: true, version: 'v8' })[0].net;
  const provider = new ethers.JsonRpcProvider(process.env.LATHEON_RPC_URL || net.rpcUrl, net.chainId, { staticNetwork: true });
  const signer = new ethers.Wallet(pk, provider);
  const secretsFile = path.join(os.homedir(), 'latheon-v8-flow-secrets.json');
  console.log('Secrets of this run go to ' + secretsFile + ' (private; not needed once the run passes)');
  const r = await run({ signer, provider, registry, secretsFile, tx: (h) => (net.explorerUrl ? net.explorerUrl.replace(/\/$/, '') + '/tx/' + h : h) });
  process.exit(r.failed ? 1 : 0);
}

if (require.main === module) main().catch((e) => { console.error('Error:', e.shortMessage || e.message); process.exit(1); });
module.exports = { run };
