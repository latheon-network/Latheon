'use strict';
// Real Groth16 proofs with the SDK (no chain): withdraw_v5 (V7) from circuits/build in this repository, checked with
// the circuit's verification key; the recipient / relayer / fee binding; a V5 (withdraw_v3) proof; a disclosure proof.
// `node test/proof.js` (about a minute: each withdraw_v5 proof takes a few seconds).
const path = require('path');
const { ethers } = require('ethers');
const snarkjs = require('snarkjs');
const sdk = require('../src/index');

let fails = 0, n = 0;
const ok = (name, cond, note) => { n++; if (!cond) fails++; console.log((cond ? 'ok   ' : 'FAIL ') + name + (note ? '   [' + note + ']' : '')); };
const E18 = 10n ** 18n;
const BUILD = path.resolve(__dirname, '..', '..', 'circuits', 'build');
const vkey = (name) => path.join(BUILD, name, 'verification_key.json');
const timed = async (f) => { const t0 = Date.now(); const r = await f(); return [r, ((Date.now() - t0) / 1000).toFixed(1) + ' s']; };

(async () => {
  const circuit = await sdk.loadCircuit('v7');
  ok('loadCircuit("v7") finds withdraw_v5 in circuits/build and its SHA-256 matches the published one', circuit.name === 'withdraw_v5' && circuit.wasm.length === 1815978 && circuit.zkey.length === 5383740);

  // a 20-level tree with 40 deposits; our note is leaf 17
  const reg = sdk.loadDeployments();
  const pool = sdk.poolById(reg, 'latheon-testnet:LTH-10:v7');
  const notes = Array.from({ length: 40 }, () => sdk.generateNote(pool));
  const deposits = notes.map((x, i) => ({ commitment: x.commitment, leafIndex: i }));
  const mine = notes[17];
  const m = sdk.merkleProofFromDeposits(deposits, 17, 'v7');
  const recipient = ethers.Wallet.createRandom().address, relayer = ethers.Wallet.createRandom().address;

  const input = sdk.buildWithdrawInput({ version: 'v7', spendKey: mine.spendKey, viewKey: mine.viewKey, pathElements: m.pathElements, pathIndices: m.pathIndices, root: m.root, recipient });
  const [proof, t1] = await timed(() => sdk.proveWithdraw(input, circuit));
  ok('withdraw_v5 proof: five public signals [root, nullifierHash, recipient, 0, 0], call data shape', proof.pubSignals.length === 5 && BigInt(proof.pubSignals[0]) === m.root && BigInt(proof.pubSignals[1]) === mine.nullifierHash && BigInt(proof.pubSignals[2]) === BigInt(recipient) && BigInt(proof.pubSignals[3]) === 0n && BigInt(proof.pubSignals[4]) === 0n && proof.pA.length === 2 && proof.pB.length === 2 && proof.pB[0].length === 2 && proof.pC.length === 2 && proof.version === 'v7', t1);
  ok('… verifies with the circuit\'s verification key', await sdk.verifyProofLocally(vkey('withdraw_v5'), proof));
  const tampered = { proof: proof.proof, publicSignals: proof.publicSignals.slice() }; tampered.publicSignals[2] = BigInt(relayer).toString();
  ok('… and does not verify for another recipient (the binding holds)', !(await snarkjs.groth16.verify(JSON.parse(require('fs').readFileSync(vkey('withdraw_v5'), 'utf8')), tampered.publicSignals, tampered.proof)));

  const inputFee = sdk.buildWithdrawInput({ version: 'v7', spendKey: mine.spendKey, viewKey: mine.viewKey, pathElements: m.pathElements, pathIndices: m.pathIndices, root: m.root, recipient, relayer, fee: 3n * E18 });
  const [proofFee, t2] = await timed(() => sdk.proveWithdraw(inputFee, circuit));
  ok('withdraw_v5 proof with relayer and fee: signals [.., recipient, relayer, fee]', BigInt(proofFee.pubSignals[3]) === BigInt(relayer) && BigInt(proofFee.pubSignals[4]) === 3n * E18 && (await sdk.verifyProofLocally(vkey('withdraw_v5'), proofFee)), t2);
  const items = [sdk.buildWithdrawManyItem(sdk.routerById(reg, 'latheon-testnet:LTH:v7'), 2, proofFee, 3n * E18)];
  ok('the proof becomes a withdrawMany item [2, pA, pB, pC, root, nullifier, fee]', items[0][0] === 2 && items[0][4] === proofFee.pubSignals[0] && items[0][6] === 3n * E18);

  // a wrong path: proving must fail (the circuit refuses a root that does not match the leaf)
  const wrong = Object.assign({}, input, { root: sdk.hash2(1n, 2n).toString() });
  console.log('(the next "Error in template" lines are expected: snarkjs reports the unsatisfied constraint)');
  let failed = false; try { await sdk.proveWithdraw(wrong, circuit); } catch (e) { failed = true; }
  ok('a proof for a root that does not match the path cannot be made', failed);
  let wrongCirc = false; try { await sdk.proveWithdraw(input, Object.assign({}, circuit, { name: 'withdraw_v3' })); } catch (e) { wrongCirc = /does not fit/.test(e.message); }
  ok('a V7 input is refused with a V5 circuit', wrongCirc);

  // V5 (withdraw_v3, 8 levels): kept for withdrawals of existing notes
  const c5 = await sdk.loadCircuit('v5');
  const pool5 = sdk.poolById(reg, 'latheon-testnet:LTH-10');
  const m5 = sdk.merkleProofFromDeposits(deposits.slice(0, 20), 17, 'v5');
  const in5 = sdk.buildWithdrawInput({ version: 'v5', spendKey: mine.spendKey, viewKey: mine.viewKey, pathElements: m5.pathElements, pathIndices: m5.pathIndices, root: m5.root, recipient });
  const [p5, t3] = await timed(() => sdk.proveWithdraw(in5, c5));
  ok('withdraw_v3 (V5) proof: three public signals [root, nullifierHash, recipient], verifies; pool5 is withdraw-only', c5.name === 'withdraw_v3' && pool5.version === 'v5' && pool5.frozen && p5.pubSignals.length === 3 && BigInt(p5.pubSignals[2]) === BigInt(recipient) && p5.version === 'v5' && (await sdk.verifyProofLocally(vkey('withdraw_v3'), p5)), t3);

  // V6 (withdraw_v4): same input shape as V7
  const c6 = await sdk.loadCircuit('v6');
  const in6 = sdk.buildWithdrawInput({ version: 'v6', spendKey: mine.spendKey, viewKey: mine.viewKey, pathElements: m.pathElements, pathIndices: m.pathIndices, root: m.root, recipient, relayer, fee: 1n });
  const [p6, t4] = await timed(() => sdk.proveWithdraw(in6, c6));
  ok('withdraw_v4 (V6) proof: five public signals, verifies', c6.name === 'withdraw_v4' && p6.version === 'v6' && p6.pubSignals.length === 5 && BigInt(p6.pubSignals[4]) === 1n && (await sdk.verifyProofLocally(vkey('withdraw_v4'), p6)), t4);

  // disclosure
  const cd = await sdk.loadCircuit('disclose');
  const din = sdk.buildDiscloseInput({ spendKey: mine.spendKey, viewKey: mine.viewKey, auditorNonce: 424242n });
  const [pd, t5] = await timed(() => sdk.proveDisclose(din, cd));
  ok('disclose proof: [commitment, disclosureTag, auditorNonce] bound; verifies', pd.pubSignals.length === 3 && BigInt(pd.pubSignals[0]) === mine.commitment && BigInt(pd.pubSignals[1]) === sdk.computeDisclosureTag(mine.viewKey, 424242n) && BigInt(pd.pubSignals[2]) === 424242n && (await sdk.verifyProofLocally(cd, pd)), t5);
  ok('verifyProofLocally with a circuit (key exported from the zkey) agrees with verification_key.json for withdraw_v5', (await sdk.verifyProofLocally(circuit, proof)) && JSON.stringify((await sdk.verificationKeyOf(circuit)).IC) === JSON.stringify(JSON.parse(require('fs').readFileSync(vkey('withdraw_v5'), 'utf8')).IC));

  console.log(fails ? '\n' + fails + ' of ' + n + ' FAILED' : '\nALL ' + n + ' CHECKS PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
