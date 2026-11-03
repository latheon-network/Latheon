# V7 regression tests (withdraw_v5 circuit and V7 contracts)

Regression checks for `circuits/withdraw_v5.circom` and the V7 contracts (`LatheonShieldedPoolV7`,
`LatheonShieldedPoolV7Native`, `LatheonDistributionPoolV7`, `LatheonDistributionPoolV7Native`, `WithdrawVerifierV5`)
with **real Groth16 proofs** against the committed `circuits/build/withdraw_v5` files, on a ganache EVM inside the test
process. Nothing talks to a network and nothing is deployed anywhere. Internal test, not an audit.

The suite reuses the helpers of `test/zk-review` (`lib.js`, `evm.js`, `circom.js`) and its `node_modules`
(`test/native`'s work too):

```
cd test/zk-review && npm install && cd ../regression-v7
npm test                                    # all four parts, about 10 minutes (≈140 proofs of the 20-level circuit)
node run.js selector                        # one part: selector | binding | nullifier | many
CIRCOM=/path/to/circom-2.2.3 npm test       # plus the r1cs-level check of every bad witness (fresh build from source)
```

Exit code 0 means every check passed. A message from ganache about "µWS is not compatible with your Node.js build" is
harmless.

## What is checked

1. **`selector` — `pathIndices[i] * (1 - pathIndices[i]) === 0` on every Merkle level.** The committed
   `withdraw_v5_final.zkey` carries exactly 20 constraints of the form s·(1−s)=0, one per `pathIndices` wire (28..47),
   and the `withdraw_v4` key carries none. For each level 0..19 a selector of 2 and of p−1 (everything else honest, the
   root recomputed the way `MultiMux1` would) is refused by the `withdraw_v5` witness generator, and the same witness
   made with the `withdraw_v4` wasm (same wire layout, no bit check) and proven with the final v5 key is rejected by the
   v5 verification key while the v4 key accepts it, so the rejection is due to the bit constraint and nothing else. Also:
   2 on all 20 levels at once; (p+1)/2, 3 and p−1 on levels 0, 9, 19 at once; the full forgery to a live pool root
   (a note that was never deposited) is refused by the ERC-20 and the native V7 pool with "Invalid proof" and no balance
   change. Control: honest paths `0101…` and `1010…` (selectors 0 and 1 on every level) verify in snarkjs and in
   `WithdrawVerifierV5`. With `CIRCOM`, each bad witness is also checked against the r1cs built from
   `circuits/withdraw_v5.circom` and the selector wires are matched to `main.pathIndices[i]` in the `.sym` file.
2. **`binding` — recipient, relayer and fee cannot be changed after the proof is made.** For an honest proof bound to
   (recipient A, relayer R, fee 0.25 of a 10-unit note) on both pool variants: recipient → B, relayer → R2, relayer → 0
   with fee → 0, fee → 0 with the relayer kept, fee ± 1 wei, fee → DENOMINATION, recipient ↔ relayer swapped — every
   one is refused by `withdraw()` ("Invalid proof"), the note stays unspent and no balance moves; the same substitutions
   as a `withdrawMany()` item (other recipient, other relayer, item fee ± changed) are refused by both routers; +1 on each
   of the three public signals and the swap are rejected by snarkjs and the bare `WithdrawVerifierV5`. The original
   tuple, sent by an account unrelated to the note, pays DENOMINATION − fee to A and fee to R, directly and through
   `withdrawMany()`; the `Withdrawal` event reports A, R and the fee.
3. **`nullifier` — a note is spent once.** After a withdrawal: the same calldata again, a fresh proof for another
   recipient at the same root, a fresh proof at a newer root (still in the history) and the spent note as a
   `withdrawMany()` item are all refused with "Note already spent". A batch [fresh note, spent note] reverts as a whole
   and the fresh note stays unspent; a batch holding the same unspent note twice (two different proofs) reverts as a
   whole and the note stays unspent; that note then withdraws alone.
4. **`many` — `withdrawMany` with 2 and 16 notes works, 17 are refused.** `MAX_WITHDRAWALS` is 16. A router deposit of
   399 units lands 17 notes (3 × 100, 50, 4 × 10, 9 × 1), each proven for one recipient. All 17 in one call →
   "Too many withdrawals" with nothing paid and none of the 17 spent (also 16 valid + a duplicate item). The first 16 in
   one transaction pay exactly 398 (`WithdrawnMany(notes = 16)`), the 17th withdraws alone with the proof made for the
   refused batch, the pools are empty again. A batch of 2 notes with a 0.1 fee bound into each proof pays 10.8 to the
   recipient and 0.2 to the relayer named in the proofs (`WithdrawnMany(notes = 2)`); another relayer is refused.

Both the ERC-20 (`LatheonToken`) and the native-coin pools and routers are exercised in parts 2–4 and in the forgery of
part 1. Compiled with solc `evmVersion: paris`, run on ganache `shanghai`, as the other suites.

## What it does not cover

Re-entrancy, root history and tree capacity are covered in `test/native-v7`; random sequences in `test/fuzz-v7`; the
pre-V7 forgery and artifact consistency in `test/zk-review`. Without `CIRCOM` the r1cs-level step is skipped (the zkey
coefficient check, the witness-generator refusal and the key-level rejection still run).
