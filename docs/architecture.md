# Latheon Architecture

## Overview

Latheon is being developed as a modular blockchain architecture with privacy-preserving transactions at its core. The current implementation is a focused prototype of the privacy layer, not a complete network. See [`STATUS.md`](../STATUS.md) for exactly what is live versus planned.

## Current flow (V5 pools)

```
User
  |
  | deposit (fixed size: 100 / 50 / 10 / 1)
  v
LatheonShieldedPoolV5  ── holds the tokens; the commitment is inserted into
  |                       an on-chain Poseidon Merkle tree in the same transaction
  | spendKey / viewKey known only to the depositor
  v
Prover in the browser (snarkjs, circuits/withdraw_v3.circom)
  |
  | Groth16 proof over (root, nullifierHash, recipient)
  v
Groth16Verifier.verifyProof(...)  ── on-chain; the third signal is taken from
  |                                   the address the pool is about to pay
  | valid proof + known root + unused nullifier
  v
Withdrawal to the recipient the proof was made for
```

Optionally, `circuits/disclose.circom` produces a separate proof that binds one deposit to one auditor's nonce (see
[`selective-disclosure-design.md`](./selective-disclosure-design.md)). Full mechanics and honest limitations:
[`THREAT-MODEL.md`](../THREAT-MODEL.md). Earlier generations (V3, V4) are described in `STATUS.md`; they lack the recipient binding.

## Repository layout

```
contracts/   token, faucet, pools (V3, V4, V5), verifiers, Poseidon hashing library
circuits/    circom circuits (withdraw v1/v2/v3, disclose) and compiled artifacts in build/
sdk/         demo app, pool registry (deployments.json), JavaScript SDK (V3 pool)
site/        landing page source
test/        Remix unit tests, V5 integration tests, reference demo end-to-end test
tools/       zk-toolkit.html, privacy-simulation
docs/        this document and related technical notes (index: docs/README.md)
```

## Design principles

**Private by default**: sensitive transaction data is not exposed unless the owner chooses to reveal it.

**Verifiable, not opaque**: privacy should never prevent an authorized party (an auditor, a partner) from confirming what they are entitled to confirm.

**Modularity**: execution, privacy, data availability, and settlement are designed to evolve independently where practical, even though today's prototype only demonstrates the privacy layer.

**Open by default**: contracts, circuits, and tooling are public and meant to be independently inspected and reproduced.

## Current vs. future components

| Component | Today | Planned / Vision |
|---|---|---|
| Execution environment | Solidity/EVM on Ethereum Sepolia, Arbitrum Sepolia and Robinhood Chain testnets | Possible dual EVM + WASM (VISION, see `ROADMAP.md`) |
| Privacy | Groth16 zk-SNARK, fixed-size pools, recipient-bound proofs, selective disclosure (V5) | Larger anonymity sets; arbitrary amounts via a distribution pool (design: `distribution-pool-architecture.md`) |
| Commitment tree | On-chain Poseidon incremental Merkle tree, updated in the deposit transaction (live since V3) | none needed |
| Validators | None; inherits the host networks' security | An L2 would inherit Ethereum's validators; no own validator set is planned (see `ROADMAP.md`) |
| Consensus | Inherited from the host networks | No dedicated consensus layer planned (see `ROADMAP.md`) |
| Proving system | Groth16 with development keys from single-party setups | Public multi-party ceremony before any real-value deployment; PLONK/Halo evaluation (VISION) |

This table intentionally mirrors `STATUS.md` and `ROADMAP.md`; all three documents are kept in sync rather than repeating conflicting claims.
