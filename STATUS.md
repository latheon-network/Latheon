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

## 1. Deployed contracts (🟢 LIVE) — production track

All on Ethereum Sepolia:

| Contract | Address |
|---|---|
| LatheonToken (LTH) | `0x53F7f947D150D41FecAC4e3FBE04cdD1bf19F67D` |
| LatheonShieldedPoolV3 (zk-SNARK, on-chain Merkle tree) | `0x9d047AdA4e33D28fBd86220f3F899A7Df7e3360C` |
| Groth16Verifier | `0x5E4D51352153513A9085e4e65B8541f393E4D470` |
| PoseidonT3 (hashing library) | `0x33bA81C2f2ef705910Ee7022d8e2481eD83aDD1B` |
| LatheonFaucet | `0xF4ab260E65D7c6bEE3D1192d2Cef677199B1f214` |

Source code is verified on Sourcify and Blockscout — inspect it directly from the Etherscan links above.

**LatheonFaucet (🟢 LIVE):** anyone can call `claim()` to receive 500 test LTH, once every 24 hours per address — no need to request tokens from the team directly. Funded with 50,000 LTH at launch (100 claims).

**Test coverage (🟢 LIVE):** all three core contracts above — LatheonToken, LatheonFaucet, LatheonShieldedPoolV3 — have automated Solidity unit tests (18 checks total, all passing), runnable directly in Remix with no local setup. Pool tests use a mock verifier to test contract logic (deposits, root tracking, double-spend prevention) independently of the real cryptography, which is separately confirmed by the actual on-chain proof already verified on Sepolia.

**Developer SDK and reference app (🟢 LIVE):** a JavaScript SDK (`sdk/`) automates commitment/nullifier computation and Merkle proof construction from on-chain events — the part that previously required manually reading `zeros()` and `roots()` by hand. `sdk/demo-app.html` is a real, wallet-connected reference application: connect MetaMask, claim from the faucet, deposit, and withdraw, with the Merkle path built automatically. A full deposit → withdraw cycle through this app has been executed and confirmed on Sepolia — not a mockup.

**Block explorer integration (🟢 LIVE):** the website's documentation section includes a live activity feed, pulling real deposit/withdrawal/claim transactions directly from Blockscout's public API.

## 2. Demonstrated flow (🟢 LIVE) — production track

1. LTH is deposited into the shielded pool (fixed denomination: 100 LTH). The deposit inserts the commitment into an **on-chain** incremental Merkle tree in the same transaction — no separate step, no operator involved.
2. A zero-knowledge proof is generated off-chain, proving knowledge of a secret tied to a deposit — without revealing which one.
3. The proof is submitted to `Groth16Verifier.verifyProof(...)` via `LatheonShieldedPoolV3.withdraw(...)`.
4. The proof is verified fully on-chain, checked against the contract's own known-root history.
5. Withdrawal completes to a recipient address with no cryptographic link back to the depositor.

This exact flow — including the on-chain Merkle tree update — has been executed and confirmed on Sepolia.

## 3. Structured selective disclosure — experimental parallel track (🟢 LIVE, both flows confirmed)

Separate from the production track above, and **not a replacement for it** — see `docs/selective-disclosure-design.md` for the full design. This addresses a real limitation of the production track's disclosure mechanism (§7 below): sharing your `secret` today grants full spending power, not just proof of authorship. The design splits a single secret into `spendKey` (spend-only) and `viewKey` (disclosure-only).

| Contract | Address | Status |
|---|---|---|
| LatheonShieldedPoolV4 | `0x5E81DB3aE24B5B6d7E4d853933EF37b55d2ccDC7` | 🟢 Deployed, deposit→withdraw tested end-to-end |
| Groth16Verifier (for `withdraw_v2.circom`) | `0x7d957dA586C00010e69e5Ed1192171F9a117626C` | 🟢 Deployed, confirmed matching on-chain |
| Groth16Verifier (for `disclose.circom`) | `0xd56e6125b2dF850D32F8c3538fF840528c53caf5` | 🟢 Deployed, confirmed matching on-chain |
| PoseidonT3 (separate instance for V4) | `0x4EB857fEb8FC91F438122270aBbb16F6a5891720` | 🟢 Deployed |

**What's confirmed working end-to-end (🟢 LIVE) — both halves:**
- **Withdrawal:** `circuits/withdraw_v2.circom` (commitment depends on both `spendKey` and `viewKey`) compiles cleanly and a real deposit → proof → withdraw cycle has been executed and confirmed on-chain against `LatheonShieldedPoolV4`.
- **Disclosure:** `circuits/disclose.circom` compiles cleanly, and a real proof — binding `viewKey` to an auditor's nonce without revealing either `spendKey` or `viewKey` — has been generated and independently verified via a direct, read-only on-chain call to its deployed `Groth16Verifier`. This is exactly the flow a real auditor would perform: no wallet, no gas, no trust in the depositor's word required.

Both circuits reuse a saved `.zkey` across sessions rather than requiring a fresh trusted setup each time — see `DEPLOYMENT-CHECKLIST.en.md`.

This entire track is a solo-founder research prototype, not something we'd currently recommend building on. It exists to prove the design is implementable, ahead of grant-funded work to harden and properly launch it.

## 4. In development (🟡 IN DEVELOPMENT)

- Automated test coverage for `LatheonShieldedPoolV4` and the disclosure verifier (currently only manually tested, unlike V3's 18 automated checks).

## 5. Near-term targets (🔵 TARGET)

- Genesis Cohort: onboarding external builders, integration partners, and validator operators.
- Independent review of the zero-knowledge circuit(s).
- Security audit ahead of any mainnet consideration.
- A decision on whether/how the selective-disclosure track (§3) merges into the production track, once it's fully tested.

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

- No formal third-party security audit has been performed, on either track.
- The circuits and contracts have had limited external review.
- This is a solo-founder prototype built with AI-assisted development, not yet a funded team effort.
- Metadata (transaction timing, gas usage) remains publicly visible on-chain — see `THREAT-MODEL.md` for the full picture of what is and isn't protected.
- **Production track (V3):** selective disclosure today means sharing your `secret` directly, which also grants spending power — see §3 above and `docs/selective-disclosure-design.md` for the fix, which is now working on a separate experimental track.
- **Experimental track (V4):** confirmed working end-to-end on testnet, but has had no independent security review or automated test coverage yet — see §4.

## 8. Verification

Anyone can independently confirm the claims in §1–2 via the Etherscan links above, or by cloning this repository and reproducing the flow using `tools/zk-toolkit.html` and `circuits/withdraw.circom`. For the experimental track, see `circuits/withdraw_v2.circom`, `circuits/disclose.circom`, and `contracts/LatheonShieldedPoolV4.sol`.

---

**Development principle:** working prototype → open source → public testnet → external developers → validators → audited mainnet candidate. Claims about future capabilities are intentionally kept separate from what is demonstrated today.
