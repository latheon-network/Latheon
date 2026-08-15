# Latheon Architecture

## Overview

Latheon is being developed as a modular blockchain architecture with privacy-preserving transactions at its core. The current implementation is a focused prototype of the privacy layer, not a complete network — see [`STATUS.md`](../STATUS.md) for exactly what's live versus planned.

## Current prototype flow

```
User
  |
  | deposit (fixed denomination)
  v
LatheonShieldedPool  ── holds locked tokens
  |
  | secret known only to depositor
  v
Off-chain prover (tools/zk-toolkit.html or your own snarkjs setup)
  |
  | Groth16 zero-knowledge proof
  v
Groth16Verifier.verifyProof(...)  ── on-chain, no secret ever transmitted
  |
  | valid proof + unused nullifier
  v
Withdrawal to any chosen recipient address
```

Full mechanics and honest limitations: [`THREAT-MODEL.md`](../THREAT-MODEL.md).

## Repository layout

```
contracts/   LatheonToken.sol, LatheonShieldedPool.sol, LatheonShieldedPoolZK.sol, Verifier.sol
circuits/    withdraw.circom — the zero-knowledge circuit, testable at zkrepl.dev
tools/       zk-toolkit.html — browser-based trusted setup, proving, and verification
docs/        this document and related technical notes
```

## Design principles

**Private by default** — sensitive transaction data is not exposed unless the owner chooses to reveal it.

**Verifiable, not opaque** — privacy should never prevent an authorized party (an auditor, a partner) from confirming what they're entitled to confirm.

**Modularity** — execution, privacy, data availability, and settlement are designed to evolve independently where practical, even though today's prototype only demonstrates the privacy layer.

**Open by default** — contracts, circuits, and tooling are public and meant to be independently inspected and reproduced.

## Current vs. future components

| Component | Today | Planned / Vision |
|---|---|---|
| Execution environment | Solidity/EVM (Sepolia) | Possible dual EVM + WASM (VISION, see `ROADMAP.md`) |
| Privacy | Groth16 zk-SNARK, demonstrated end-to-end | Larger anonymity sets, protocol-level selective disclosure |
| Commitment tree | Off-chain, owner-published root | On-chain Poseidon-based Merkle tree (NEXT) |
| Validators | None (uses Ethereum Sepolia's) | Own validator set (VISION) |
| Consensus | Inherited from Ethereum Sepolia | Dedicated consensus layer (VISION) |
| Proving system | Groth16 (trusted setup via public Powers of Tau) | PLONK/Halo evaluation (VISION) |

This table intentionally mirrors `STATUS.md` and `ROADMAP.md` — all three documents are kept in sync rather than repeating conflicting claims.
