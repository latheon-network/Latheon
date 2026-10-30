# Trusted setup for withdraw_v4: development keys, not a production ceremony

**Do not use these keys to protect real funds.** They exist so the V6 pools can be tested end to end on testnets.

## What the circuit is

`circuits/withdraw_v4.circom` is `withdraw_v3` with two changes:

- **Tree depth 20 instead of 8.** A pool built for it holds 2^20 = 1,048,576 deposits instead of 256. Splitting deposits over several pools of the same size was rejected because it would shrink every withdrawal's anonymity set.
- **Relayer and fee bound into the proof.** Two more public inputs, `relayer` and `fee`. The pool pays `fee` to `relayer` and the rest to `recipient`; whoever submits the withdrawal can change none of the three.

Commitment, nullifier and the spendKey/viewKey split are unchanged, so notes keep their format and the disclosure circuit is unchanged.

## What was done

- Compiled with circom 2.2.3 and circomlib 2.0.5: 11,934 constraints (5,632 non-linear, 6,302 linear), 5 public inputs (`root`, `nullifierHash`, `recipient`, `relayer`, `fee`). For comparison, `withdraw_v3` has 5,704.
- Powers of tau: BN128, power 14 (up to 16,384 constraints), one contribution (`dev-ceremony-v4-phase1`).
- Phase 2: one contribution (`dev-ceremony-v4-phase2`).
- Both phases were run by a single operator in a single environment, on 26 October 2026. That is exactly the situation a public multi-party ceremony exists to avoid: whoever ran it could, in principle, have kept the secret randomness and could forge proofs.
- `snarkjs zkey verify` (zkey against r1cs and ptau) passes. That confirms the files are consistent with each other, not that the randomness was destroyed.

The matched set is `circuits/build/withdraw_v4/withdraw_v4.wasm` + `withdraw_v4_final.zkey` + `contracts/WithdrawVerifierV4.sol` (contract `WithdrawVerifierV4`, generated from this zkey). They must always be used together.

## SHA-256 of the artifacts

```
f9514eaa4881a68c5d8be0d6f5088c5ff23beec4085570acba89e0b97ce3deed  withdraw_v4_final.zkey
6e8b9e9d07aae29873729caf56cdbc718ced8a4523d7a7b5f7a5890e3f290144  pot14_final.ptau (committed in circuits/ptau/ since 30 October 2026; see dev-ceremony-v5.md to check the key)
ba1cf9034e40a2cffa6ee3039c014b9630886c9153d64816099c460c0fad9701  withdraw_v4.wasm
```

## What has to happen before any real-money deployment

An independent review of the circuit, then a public multi-party ceremony with independent, named participants for the final circuit. Every circuit change means a new ceremony, new verifiers and new pools.
