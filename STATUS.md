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
| LatheonShieldedPoolV3 (zk-SNARK, on-chain Merkle tree) | `0x9d047AdA4e33D28fBd86220f3F899A7Df7e3360C` |
| Groth16Verifier | `0x5E4D51352153513A9085e4e65B8541f393E4D470` |
| PoseidonT3 (hashing library) | `0x33bA81C2f2ef705910Ee7022d8e2481eD83aDD1B` |

Source code is verified on Sourcify and Blockscout — inspect it directly from the Etherscan links above.

## 2. Demonstrated flow (🟢 LIVE)

1. LTH is deposited into the shielded pool (fixed denomination: 100 LTH). The deposit inserts the commitment into an **on-chain** incremental Merkle tree in the same transaction — no separate step, no operator involved.
2. A zero-knowledge proof is generated off-chain, proving knowledge of a secret tied to a deposit — without revealing which one.
3. The proof is submitted to `Groth16Verifier.verifyProof(...)` via `LatheonShieldedPoolV3.withdraw(...)`.
4. The proof is verified fully on-chain, checked against the contract's own known-root history.
5. Withdrawal completes to a recipient address with no cryptographic link back to the depositor.

This exact flow — including the on-chain Merkle tree update — has been executed and confirmed on Sepolia.

## 3. What changed since the last update

The Merkle commitment tree is now **fully on-chain** (`LatheonShieldedPoolV3`), using an on-chain Poseidon hash implementation. This replaces the earlier prototype (`LatheonShieldedPoolZK`), which relied on an off-chain-maintained, owner-published root. That centralization point is now closed — no owner or operator action is required anywhere in the deposit → withdraw flow.

## 4. In development (🟡 IN DEVELOPMENT)

- Expanded automated test coverage for contracts and circuits.
- Developer-facing documentation and SDK.
- Public testnet infrastructure (faucet, explorer integration).

## 5. Near-term targets (🔵 TARGET)

- Public testnet: faucet, block explorer integration, external deployment instructions.
- Genesis Cohort: onboarding external builders, integration partners, and validator operators.
- Independent review of the zero-knowledge circuit.
- Security audit ahead of any mainnet consideration.

## 6. Long-term vision (⚪ VISION)

The following are **not implemented today** and should not be read as current capabilities:

- A sovereign Latheon consensus layer (own validator set).
- DAG-based mempool with BFT finality.
- Modular data availability (including data availability sampling).
- Native EVM + WASM dual execution environment.
- Native light clients for Ethereum/Bitcoin interoperability.
- PLONK/Halo-style proving as an alternative to Groth16.
- A permissionless validator network with staking and slashing.
- Mainnet deployment.

These are research directions for a 12–18 month horizon, contingent on funding and team growth — see `ROADMAP.md`.

## 7. Known limitations

- No formal third-party security audit has been performed.
- The circuit and contracts have had limited external review.
- This is a solo-founder prototype built with AI-assisted development, not yet a funded team effort.
- Metadata (transaction timing, gas usage) remains publicly visible on-chain — see `THREAT-MODEL.md` for the full picture of what is and isn't protected.

## 8. Verification

Anyone can independently confirm the claims in §1–2 via the Etherscan links above, or by cloning this repository and reproducing the flow using `tools/zk-toolkit.html` and `circuits/withdraw.circom`.

---

**Development principle:** working prototype → open source → public testnet → external developers → validators → audited mainnet candidate. Claims about future capabilities are intentionally kept separate from what is demonstrated today.
