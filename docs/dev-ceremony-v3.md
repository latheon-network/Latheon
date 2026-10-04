# Trusted setup for withdraw_v3: development keys, not a production ceremony

**Do not use these keys to protect real funds.** They exist so the fixed circuit can be tested end to end on testnets.

## What was done

- Circuit: `circuits/withdraw_v3.circom`, compiled with circom 2.2.3 (5704 constraints, 3 public inputs).
- Powers of tau: BN128, power 13, one contribution (`dev-ceremony-phase1`).
- Phase 2: one contribution (`dev-ceremony-phase2`).
- Both phases were run by a single operator in a single environment. That is exactly the situation a public multi-party ceremony exists to avoid: whoever ran it could, in principle, have kept the secret randomness and could forge proofs.
- `snarkjs zkey verify` (zkey against r1cs and ptau) passes. That confirms the files are consistent with each other, not that the randomness was destroyed.

The matched set is `withdraw_v3.wasm` + `withdraw_v3_final.zkey` + `WithdrawVerifierV3.sol`. They must always be used together; a verifier generated from a different zkey will reject every proof from this one (we have hit this failure mode before).

## SHA-256 of the artifacts

```
6e2fee21fefb1ec06db5ebf0d1fa588b0f8e3a92427894b32bf3521a904dce94  withdraw_v3_final.zkey
7a305de0efe5e6ca7ef49815fba3448c86f2fc502ed0600adf6adceb896023f2  pot13_final.ptau
20aea3d282af1dbdf46206219c25511b9446e88a04e1068cbdd89d76ee7c6623  withdraw_v3.wasm
```

## What has to happen before any real-money deployment

A public multi-party ceremony with independent, named participants, for the final circuit. Every circuit change means a new ceremony, which means new verifiers and new pools, so the circuit should be frozen (and ideally externally reviewed) first.
