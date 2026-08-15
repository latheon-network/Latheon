# Latheon — Current Status

> Private by default. Verifiable on demand.

**Status:** Experimental public prototype
**Network:** Ethereum Sepolia (testnet)
**Stage:** Pre-public-testnet prototype

This document separates what is currently implemented and independently verifiable from what remains part of the longer-term Latheon vision. Every claim below is labeled:

🟢 **LIVE** — verifiable on-chain right now
🟡 **IN DEVELOPMENT** — code/work exists, not complete
🔵 **TARGET** — a measurable near-term goal
⚪ **VISION** — long-term architecture, not yet started

---

## 1. Deployed contracts (🟢 LIVE)

All on Ethereum Sepolia:

| Contract | Address |
|---|---|
| LatheonToken (LTH) | `0x53F7f947D150D41FecAC4e3FBE04cdD1bf19F67D` |
| LatheonShieldedPool (zk-SNARK) | `0x22dEe9507b9a00A12bc6aB8B63Ab5CD3868543e4` |
| Groth16Verifier | `0xB38399602B6Fd721E371abAD675a6f28BB3E7344` |

Source code is verified on Sourcify and Blockscout — inspect it directly from the Etherscan links above.

## 2. Demonstrated flow (🟢 LIVE)

1. LTH is deposited into the shielded pool (fixed denomination: 100 LTH).
2. A zero-knowledge proof is generated off-chain, proving knowledge of a secret tied to a deposit — without revealing which one.
3. The proof is submitted to `Groth16Verifier.verifyProof(...)`.
4. The proof is verified fully on-chain.
5. Withdrawal completes to a recipient address with no cryptographic link back to the depositor.

This exact flow has been executed and confirmed on Sepolia; transaction hashes are available on request and referenced in the build log under `docs/`.

## 3. In development (🟡 IN DEVELOPMENT)

- **On-chain Merkle commitment tree.** The pool currently relies on an off-chain-maintained deposit record (the pool owner recomputes and publishes the Merkle root after each deposit) rather than an on-chain-updated tree. This is the single most important near-term engineering item — see [`ROADMAP.md`](./ROADMAP.md).
- Expanded automated test coverage for contracts and circuits.
- Developer-facing documentation and SDK.

## 4. Near-term targets (🔵 TARGET)

- Public testnet: faucet, block explorer integration, external deployment instructions.
- Genesis Cohort: onboarding external builders, integration partners, and validator operators.
- Security audit ahead of any mainnet consideration.

## 5. Long-term vision (⚪ VISION)

The following are **not implemented today** and should not be read as current capabilities:

- A sovereign Latheon consensus layer (own validator set).
- DAG-based mempool with BFT finality.
- Modular data availability (including data availability sampling).
- Native EVM + WASM dual execution environment.
- Native light clients for Ethereum/Bitcoin interoperability.
- PLONK/Halo-style proving as an alternative to Groth16.
- A permissionless validator network with staking and slashing.
- Mainnet deployment.

These are research directions for a 12–18 month horizon, contingent on funding and team growth, and are described further in [`ROADMAP.md`](./ROADMAP.md).

## 6. Known limitations

- No formal third-party security audit has been performed.
- The Merkle tree bookkeeping described in §3 is currently centralized (owner-updated), a deliberate and disclosed simplification — see [`THREAT-MODEL.md`](./THREAT-MODEL.md) for what this does and does not affect.
- The circuit and contracts have had limited external review.
- This is a solo-founder prototype built with AI-assisted development, not yet a funded team effort.

## 7. Verification

Anyone can independently confirm the claims in §1–2 via the Etherscan links above, or by cloning this repository and reproducing the flow using `tools/zk-toolkit.html` and `circuits/withdraw.circom`.

---

**Development principle:** working prototype → open source → public testnet → external developers → validators → audited mainnet candidate. Claims about future capabilities are intentionally kept separate from what is demonstrated today.
