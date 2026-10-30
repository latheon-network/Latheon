# Trusted setup for withdraw_v5: development keys, not a production ceremony

**Do not use these keys to protect real funds.** They exist so the V7 pools can be tested end to end on testnets.

## Why withdraw_v5 exists: a critical fix (found in internal review)

`circuits/withdraw_v5.circom` is `withdraw_v4` with one change, and it closes a critical flaw that was present in **every earlier circuit** (`withdraw.circom`, `withdraw_v2`, `withdraw_v3`, `withdraw_v4`):

- **The Merkle path selector was never constrained to a bit.** `MerkleTreeChecker` fed `pathIndices[i]` straight into circomlib's `MultiMux1`, which computes `out = (c1 - c0) * s + c0` and does **not** force `s` to be 0 or 1. Nothing else constrained it either. With a non-binary selector the prover can make a mux output any field element, and so satisfy `root === levelHashes[levels]` for a commitment that was never deposited — the pool's current root has two public children (`filledSubtrees`, `zeros` are public getters), and a path can be interpolated to them. The result is withdrawal without a deposit: the pool can be drained. This was confirmed with a transaction-level proof of concept on a local chain (an attacker with zero deposits emptied a pool).
- **The fix** adds `pathIndices[i] * (1 - pathIndices[i]) === 0` at every level — the `s * (1 - s) === 0` check the original Tornado Cash `DualMux` carried and that was lost when the code moved to circomlib's `MultiMux1`. Nothing else changes: tree depth is still 20, the public inputs are still `root, nullifierHash, recipient, relayer, fee`, and commitment/nullifier/the spendKey-viewKey split are byte-for-byte those of withdraw_v3/v4, so **notes keep the same format** and `disclose.circom` is unchanged.

After the fix, the same forgery can no longer be proven (witness generation fails on the new constraint) and an honest withdrawal still verifies.

Everything that used an earlier circuit is affected: the V5 pools (`withdraw_v3`) on Ethereum Sepolia, Arbitrum Sepolia, Robinhood Chain Testnet and the Latheon test chain; the V6 pools (`withdraw_v4`) on the Latheon test chain; and the deprecated V3/V4 pools. Those pools cannot be fixed in place — each pool's verifier is immutable — so new pools (**V7**) built on `withdraw_v5` supersede them, and the older pools must be treated as forgeable until retired.

## What was done

- Compiled with circom 2.2.3 and circomlib 2.0.5: 11,954 constraints (5,652 non-linear, 6,302 linear), 5 public inputs. For comparison, `withdraw_v4` has 11,934 — the 20 extra non-linear constraints are the per-level bit checks.
- Powers of tau: BN128, power 14, the **same phase-1 file as withdraw_v4** (`pot14_final.ptau`, hash below). Phase 1 is circuit-independent, so reuse is correct; only a fresh phase 2 is needed for the new circuit.
- Phase 2: one contribution (`dev-ceremony-v5-phase2`), run by a single operator in a single environment on 27 October 2026. This is exactly what a public multi-party ceremony exists to avoid: whoever ran it could in principle have kept the secret randomness.
- `snarkjs zkey verify` (zkey against r1cs and ptau) passes.

The matched set is `circuits/build/withdraw_v5/withdraw_v5.wasm` + `withdraw_v5_final.zkey` + `contracts/WithdrawVerifierV5.sol` (contract `WithdrawVerifierV5`, generated from this zkey). They must always be used together.

## SHA-256 of the artifacts

```
5466c0421bbdeafa85e2efcbf6e292cdb0b876e5ae21ab3fe5e14d84bd1397de  withdraw_v5_final.zkey
6e8b9e9d07aae29873729caf56cdbc718ced8a4523d7a7b5f7a5890e3f290144  pot14_final.ptau (shared with withdraw_v4; committed in circuits/ptau/ since 30 October 2026)
9d8d188ebf8d196cfb3ace1c3c808ff89563bbb6fae9f909da5495ae4b93d667  withdraw_v5.wasm
```

## Checking the keys yourself

The phase-1 file is published in `circuits/ptau/pot14_final.ptau` (30 October 2026), so anyone can check the committed keys against the circuits:

```
circom circuits/withdraw_v5.circom --r1cs -l node_modules -o /tmp   # circom 2.2.3, circomlib 2.0.5
snarkjs zkey verify /tmp/withdraw_v5.r1cs circuits/ptau/pot14_final.ptau circuits/build/withdraw_v5/withdraw_v5_final.zkey
```

Both `withdraw_v5_final.zkey` and `withdraw_v4_final.zkey` pass this check ("ZKey Ok!", 30 October 2026). It proves the keys match the circuits and this phase-1 file; it does not prove that the single operator destroyed the randomness of either phase. Notes for whoever reviews the keys:

- **Build versions:** circom 2.2.3 with circomlib 2.0.5 and the compiler's default optimisation; the committed wasm is reproduced byte for byte with these (internal review, 29 October 2026).
- **gamma = the G2 generator** in every key: the snarkjs default, as in Tornado Cash; no known attack, recorded here so it is not a surprise.
- Earlier keys: `withdraw_v3` used its own `pot13_final.ptau` (hash in `dev-ceremony-v3.md`), which was not kept, so its key cannot be checked this way; `withdraw_v2` and `disclose` were made in the browser on the public Hermez `powersOfTau28_hez_final_14.ptau` and are built with **circomlib 2.0.2 and `--O1`** (not the 2.0.5 in the repository now), so `snarkjs zkey verify` works for them with that ptau and an r1cs built the same way.

## What has to happen before any real-money deployment

An independent review of the circuit — this fix came out of an internal review, and a genuinely independent one is still needed — then a public multi-party ceremony with independent, named participants for the final circuit. Every circuit change means a new ceremony, new verifiers and new pools.
