# Latheon Architecture

## Overview

Latheon is being developed as a modular blockchain architecture with privacy-preserving transactions at its core. The current implementation is a focused prototype of the privacy layer, not a complete network. See [`STATUS.md`](../STATUS.md) for exactly what is live versus planned.

## Current flow (V7 pools on the Latheon test chain)

```
User
  |
  | deposit (fixed size: 100 / 50 / 10 / 1 LTH, paid in the chain's own coin;
  |          any amount through the router, which splits it into such notes)
  v
LatheonShieldedPoolV7Native  ── holds the coin; the commitment is inserted into
  |                             an on-chain Poseidon Merkle tree (20 levels) in the same transaction
  | spendKey / viewKey known only to the depositor
  v
Prover in the browser (snarkjs, circuits/withdraw_v5.circom)
  |
  | Groth16 proof over (root, nullifierHash, recipient, relayer, fee)
  v
WithdrawVerifierV5.verifyProof(...)  ── on-chain; recipient, relayer and fee are taken from
  |                                      the call the pool is about to pay, so none of them can be swapped
  | valid proof + known root (last 100) + unused nullifier
  v
Withdrawal to the recipient the proof was made for (sent by the user's wallet,
or by the chain's relayer, which pays the gas and receives the fee named in the proof)
```

Optionally, `circuits/disclose.circom` produces a separate proof that binds one deposit to one auditor's nonce (see
[`selective-disclosure-design.md`](./selective-disclosure-design.md)). Full mechanics and honest limitations:
[`THREAT-MODEL.md`](../THREAT-MODEL.md). Earlier generations are described in `STATUS.md`: V3/V4 lack the recipient
binding, and every circuit before V7 (V3–V6) carries the Merkle-path flaw of `THREAT-MODEL.md` §8.0, so those pools are
deprecated and kept only so existing notes can be withdrawn. Addresses: [`testnet.md`](./testnet.md), machine-readable
`sdk/deployments.json`.

## Repository layout

```
contracts/   token, faucet, pools (V3–V7; only V7 is current), distribution routers, verifiers, Poseidon hashing library
circuits/    circom circuits (withdraw v1/v2/v3/v4/v5, disclose), compiled artifacts in build/, the phase-1 ptau file in ptau/
sdk/         pool and router registry (deployments.json), router helpers (distribution.js), reference app for the frozen
             V5 pools (demo-app-v5.html), JavaScript SDK (V3 pool, see its compatibility table)
demo/        the live demo (latheon.xyz/demo), the V7 reference implementation
bridge/      the bridge page (latheon.xyz/bridge)
site/        landing page source
test/        Remix unit tests (V3/V4), Node tests with real proofs (v5-integration, distribution, native, native-v6,
             native-v7, fuzz-v7, zk-review), browser end-to-end tests for the demo and the bridge page (demo-e2e)
tools/       zk-toolkit.html, privacy-simulation, check-deployments.js and check-versions.js
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
| Execution environment | Solidity/EVM on the Latheon test chain, an Arbitrum Orbit chain settling to Arbitrum Sepolia (testnet, `testnet.md`); the earlier deployments on Ethereum Sepolia, Arbitrum Sepolia and Robinhood Chain Testnet are deprecated since 27 October 2026 | A production Arbitrum Orbit chain; where it settles is open (VISION, see `ROADMAP.md`) |
| Privacy | Groth16 zk-SNARK, fixed-size pools, proofs bound to recipient, relayer and fee, selective disclosure (V7); arbitrary amounts via the distribution router (`distribution-pool-architecture.md`); gas-free withdrawals through the chain's relayer | Larger anonymity sets; stealth addresses; bridge privacy (see `ROADMAP.md`) |
| Commitment tree | On-chain Poseidon incremental Merkle tree, updated in the deposit transaction (live since V3; 20 levels and 100 kept roots since V6) | none needed |
| Validators | One sequencer and one validator on the test chain, both run by us; the chain inherits the security of Arbitrum Sepolia only as far as that single validator is honest and live (`THREAT-MODEL.md` §8.4) | Independent validators and a multisig with a timelock before any production chain; no own validator set beyond the rollup's (see `ROADMAP.md`) |
| Consensus | Inherited from the parent chain (Arbitrum Sepolia) through the rollup | No dedicated consensus layer planned (see `ROADMAP.md`) |
| Proving system | Groth16 with development keys from single-party setups | Public multi-party ceremony before any real-value deployment; PLONK/Halo evaluation (VISION) |

This table intentionally mirrors `STATUS.md` and `ROADMAP.md`; all three documents are kept in sync rather than repeating conflicting claims.
