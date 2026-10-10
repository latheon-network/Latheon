# Latheon — Current Status

> Private by default. Verifiable on demand.

**Status:** Experimental public prototype
**Networks:** Ethereum Sepolia, Arbitrum Sepolia and Robinhood Chain Testnet (all testnets)
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

**Developer SDK and reference app (🟢 LIVE):** a JavaScript SDK (`sdk/`) automates commitment/nullifier computation and Merkle proof construction from on-chain events — the part that previously required manually reading `zeros()` and `roots()` by hand. `sdk/demo-app-v5.html` is a real, wallet-connected reference application: connect MetaMask, claim from the faucet, deposit, and withdraw, with the Merkle path built automatically. A full deposit → withdraw cycle through this app has been executed and confirmed on Sepolia — not a mockup.

**Block explorer integration (🟢 LIVE):** the website's documentation section includes a live activity feed, pulling real deposit/withdrawal/claim transactions directly from Blockscout's public API.

## 2. Demonstrated flow (🟢 LIVE) — production track

1. LTH is deposited into the shielded pool (fixed denomination: 100 LTH). The deposit inserts the commitment into an **on-chain** incremental Merkle tree in the same transaction — no separate step, no operator involved.
2. A zero-knowledge proof is generated off-chain, proving knowledge of a secret tied to a deposit — without revealing which one.
3. The proof is submitted to `Groth16Verifier.verifyProof(...)` via `LatheonShieldedPoolV3.withdraw(...)`.
4. The proof is verified fully on-chain, checked against the contract's own known-root history.
5. Withdrawal completes to a recipient address with no cryptographic link back to the depositor.

This exact flow — including the on-chain Merkle tree update — has been executed and confirmed on Sepolia.

## 2a. Current generation: V5 pools (🟢 LIVE on three testnets)

V5 supersedes the V3/V4 pools for new use. It changes two things: the withdrawal proof is **bound to the recipient address** (fixing the flaw described in §7), and the **pool size is a constructor parameter**, so one source covers every size and token.

- **Deployed:** 16 pools (100 / 50 / 10 / 1) across Ethereum Sepolia, Arbitrum Sepolia and Robinhood Chain Testnet (LTH everywhere, plus USDG on Robinhood Chain). Addresses: `docs/deployments-v5.md`; machine-readable: `sdk/deployments.json`.
- **Verified:** `test/v5-integration` runs 19 checks with real proofs on a local EVM, including a reproduction of the V3/V4 flaw and a demonstration that V5 rejects it. The demo (`sdk/demo-app-v5.html`) was also exercised end to end in a real browser against three local chains (reference script in `test/demo-e2e`) and then run live on all three testnets: deposit, withdrawal and disclosure.
- **Keys:** development keys from a single-party setup, see `docs/dev-ceremony-v3.md`. Testnets only.
- **Gas:** one on-chain reading per network so far, and the Ethereum Sepolia figure is unexplained; see the note at the top of `docs/gas-benchmark.en.md`.
- **Deploying more pools:** `docs/deploying-v5.md`.

## 2b. Distribution router (🟢 LIVE on testnets, no independent review)

A small stateless contract (`contracts/LatheonDistributionPool.sol`) on top of the V5 pools: `deposit(amount, commitments)` splits an amount into 100 / 50 / 10 / 1 notes and places them in one transaction; `withdrawMany(items, recipient)` forwards up to 16 ordinary V5 withdrawals in one transaction. It holds no funds, has no owner and takes no fee; the V5 pools and circuit are unchanged.

- **Deployed:** one router per token set: Arbitrum Sepolia (LTH), Robinhood Chain Testnet (LTH and USDG) and Ethereum Sepolia (LTH). Addresses, transactions and what was checked: `docs/distribution-pool-deployments.md`.
- **Verified:** 48 automated checks with real proofs on a local EVM (`test/distribution`), plus one manual deposit of 11 units and one `withdrawMany` of two notes with real proofs on each of the four token sets. Router balance and allowances were zero afterwards.
- **Wallet side and demo (built):** the demo deposits any amount through the router (user chooses exact or rounded-down amount, one master key for all notes) and withdraws by amount and master key (notes chosen to match the amount exactly, proofs made in the browser, one `withdrawMany` transaction, batches of 16). Helpers are in `sdk/distribution.js` (`test/distribution/wallet.js`, 25 checks); the browser flow is tested in `test/demo-e2e/router-e2e.js` (35 checks, local chains). Run live on Ethereum Sepolia: a 23-note deposit, then withdrawals of 17, 5 and 1 notes.
- **Not done:** pool-activity indicators and a planner that proposes several addresses and delays (design D2 and D4); no independent review; `withdrawMany` pays one address, so it is a convenience and does not add privacy (the notes of one withdrawal are visibly linked). Design: `docs/distribution-pool-architecture.md`.

## 3. Structured selective disclosure — experimental parallel track (🟢 LIVE, both flows confirmed)

Separate from the production track above, and **not a replacement for it** — see `docs/selective-disclosure-design.md` for the full design. This addresses a real limitation of the production track's disclosure mechanism (§7 below): sharing your `secret` today grants full spending power, not just proof of authorship. The design splits a single secret into `spendKey` (spend-only) and `viewKey` (disclosure-only).

| Contract (Ethereum Sepolia, current legacy V4) | Address | Status |
|---|---|---|
| LatheonShieldedPoolV4 | `0x8f64d930813936599f59De29eDb3B4aE38778f75` | 🟡 Deprecated (recipient not bound, see §7); deposit→withdraw confirmed on-chain |
| Groth16Verifier (for `withdraw_v2.circom`) | `0xc368136323c9d68351222ef5202f6875D8192EF8` | 🟡 Deprecated, matches the proving keys used by the demo |
| Groth16Verifier (for `disclose.circom`) | `0xd56e6125b2dF850D32F8c3538fF840528c53caf5` | 🟢 Deployed, confirmed matching on-chain |
| PoseidonT3 (library instance used for the earlier V4 deployment) | `0x4EB857fEb8FC91F438122270aBbb16F6a5891720` | 🟢 Deployed |

An earlier Ethereum V4 pool (`0x5E81DB3aE24B5B6d7E4d853933EF37b55d2ccDC7`, verifier `0x7d957dA586C00010e69e5Ed1192171F9a117626C`) was replaced because its verifier no longer matched the proving keys served by the demo. The Arbitrum Sepolia and Robinhood Chain V4 pools are listed as legacy entries in `sdk/deployments.json`.

**What's confirmed working end-to-end (🟢 LIVE) — both halves:**
- **Withdrawal:** `circuits/withdraw_v2.circom` (commitment depends on both `spendKey` and `viewKey`) compiles cleanly and a real deposit → proof → withdraw cycle has been executed and confirmed on-chain against `LatheonShieldedPoolV4`.
- **Disclosure:** `circuits/disclose.circom` compiles cleanly, and a real proof — binding `viewKey` to an auditor's nonce without revealing either `spendKey` or `viewKey` — has been generated and independently verified via a direct, read-only on-chain call to its deployed `Groth16Verifier`. This is exactly the flow a real auditor would perform: no wallet, no gas, no trust in the depositor's word required.

Both circuits reuse a saved `.zkey` across sessions rather than requiring a fresh trusted setup each time — see `DEPLOYMENT-CHECKLIST.en.md`.

**Test coverage (🟢 LIVE):** `LatheonShieldedPoolV4` has the same 6 automated checks as V3 (mock-verifier-based, testing contract logic). The disclosure verifier additionally has 3 tests using **real cryptography** — the actual, already-on-chain-confirmed proof — rather than a mock, including a test confirming a proof bound to one auditor's nonce is correctly rejected against a different nonce. 27 automated checks pass across the whole project (0 failures). V5 additionally has 19 integration checks with real proofs in `test/v5-integration`.

This entire track is a solo-founder research prototype, not something we'd currently recommend building on. It exists to prove the design is implementable, ahead of grant-funded work to harden and properly launch it.

**Cross-chain confirmation (🟢 LIVE):** the same withdrawal flow has been independently deployed and confirmed end-to-end on Arbitrum Sepolia as well — not just Ethereum Sepolia. A real deposit → proof generation → on-chain proof verification (via a free read-only call, before spending gas) → withdrawal cycle succeeded, transaction `0x69d2aca1044c48a5e5c5021be043589208025eb3b1f9708b23e190c96e54233c`. See `docs/legacy/arbitrum-sepolia-addresses-and-benchmark.md` for the full contract addresses and a real, measured gas comparison against Ethereum L1 — the honest finding is that Arbitrum Sepolia used slightly *more* gas units per operation (+1.5% deposit, +8.4% withdraw), not fewer; L2 cost savings come from gas price, not gas units, on this evidence.

**A third network, plus a second token (🟢 LIVE):** the same V4 stack is also deployed and confirmed on Robinhood Chain Testnet, on two separate token pools — our own LTH, and USDG (Paxos' regulated stablecoin, via the Global Dollar Network). Full deposit → withdraw cycles confirmed on both: LTH withdrawal `0xa2cc3289204275507856b35f3d06f6a21319d88b585e1c8f3df5120642dfa313`, USDG withdrawal `0x75e633bb667094f4babbeca91de64dcbe5a8d87b3d8397c3a8a2481965c244e2`. A real design detail worth documenting: USDG uses 6 decimals, not 18 like LTH — the legacy USDG pool contract (`contracts/LatheonShieldedPoolV4USDG.sol`) used a different fixed-denomination constant accordingly, not a blind reuse of the LTH pool's parameters (V5 makes the size a constructor argument and computes it from the token's decimals in the demo). See `docs/legacy/robinhood-chain-addresses-and-benchmark.md` for full addresses and gas figures — Robinhood Chain used *more* gas than both Ethereum L1 and Arbitrum Sepolia for the same operation (+16.9% withdraw vs L1), continuing the same honest pattern.

## 4. In development (🟡 IN DEVELOPMENT)

Nothing currently open on either track — see §5 for near-term targets.

## 5. Near-term targets (🔵 TARGET)

- Genesis Cohort: **paused, not closed.** No onboarding is happening and the sign-up form is off the website for now; the program is meant for external builders and integration partners (the validator-operator track is on hold, see `ROADMAP.md`).
- Independent review of the zero-knowledge circuit(s).
- Security audit ahead of any mainnet consideration.
- A decision on whether/how the selective-disclosure track (§3) merges into the production track, once it's fully tested.

## 6. Long-term vision (⚪ VISION) — Ethereum L2, framework under evaluation

**This section changed twice, and a third, public commitment is being deliberately held back.** Earlier: a sovereign Layer 1, built from scratch. Then: an Ethereum L2, framework undecided. Now: the L1→L2 reasoning is settled, but the specific framework is still being validated hands-on, not just decided from documentation — see `ROADMAP.md` for the full reasoning.

Not implemented today — this is a direction, not something running yet:

- **Framework: actively being evaluated.** A ZK-native framework with a dedicated compliance-oriented chain offering (matching our banking/institutional target segment) remains the leading candidate on paper — but we're gaining direct, hands-on experience in other ecosystems before naming a final choice publicly. Concretely: our full V4 stack is now deployed and confirmed working end-to-end on Arbitrum Sepolia (via Arbitrum's Singapore Buildathon), not just described as a future plan — see §3 above.
- **Deployment path:** a managed Rollup-as-a-Service provider, regardless of framework — self-hosting requires infrastructure (some frameworks' prover nodes need a documented 96-core/740GB server) well beyond solo-founder scale.
- **Mode:** rollup vs. validium is typically the first, hardest-to-reverse decision a given framework requires — to be settled once the framework itself is.
- **Gas token: LTH** — holds regardless of framework.
- Latheon's shielded pool and selective disclosure mechanism become the appchain's core application.
- Realistic properties, true across frameworks under consideration: a few seconds for trusted confirmation (not sub-second — corrected from an earlier overstatement, see `docs/gas-benchmark.en.md`), minutes-to-hours for full L1-anchored finality, fees in the fractions-of-a-cent range, and — honestly — a centralized sequencer at launch, matching virtually every production rollup today.
- **Still open, not solved:** bridge privacy leakage (funding an L2 wallet from a linkable L1 address undermines the privacy guarantee itself — see `THREAT-MODEL.md` and `ROADMAP.md` for mitigation options under consideration) and the exact timing of any L1→L2 transition (the current V3/V4 prototypes on Ethereum L1 are unaffected and keep working as-is).
- Dropped from the earlier plan: a dedicated Latheon consensus layer, a DAG-based mempool, a permissionless validator set, and native light clients — an L2 doesn't need or want its own validator set; it inherits Ethereum's.

This is a 12–18 month horizon, contingent on funding and team growth — see `ROADMAP.md`.

## 7. Known limitations

- No formal third-party security audit has been performed, on either track.
- The circuits and contracts have had limited external review.
- This is a solo-founder prototype built with AI-assisted development, not yet a funded team effort.
- Metadata (transaction timing, gas usage) remains publicly visible on-chain — see `THREAT-MODEL.md` for the full picture of what is and isn't protected.
- **Production track (V3):** selective disclosure today means sharing your `secret` directly, which also grants spending power — see §3 above and `docs/selective-disclosure-design.md` for the fix, which is now working on a separate experimental track.
- **Experimental track (V4):** confirmed working end-to-end on testnet, with automated test coverage now in place, but has had no independent security review yet.
- **Known issue (V3/V4 pools):** the withdrawal recipient is not bound to the zero-knowledge proof, so a pending withdrawal can be front-run by replaying the proof with a different recipient. Reproduced in testing; fixed in V5 (`circuits/withdraw_v3.circom`, `contracts/LatheonShieldedPoolV5.sol`). V5 pools are now deployed on the Ethereum Sepolia, Arbitrum Sepolia and Robinhood Chain testnets (`docs/deployments-v5.md`); the older V3/V4 pools stay deployed but are deprecated. Every pool is testnet-only. See `docs/withdraw-recipient-binding.md`.
- **Gas figures** in `docs/gas-benchmark*.md` date from V3/V4; live V5 readings differ and one is unexplained, see the update note at the top of those files.
- **Pool capacity and anonymity:** each pool's Merkle tree has depth 8, so a pool holds at most 256 deposits. Pools hold mostly test deposits, so anonymity sets are small today.
- **LTH is a test token** with no monetary value. The owner can mint more (`LatheonToken.mint`, `onlyOwner`).
- **Trusted setup:** all current key material comes from single-operator setups, not a public multi-party ceremony. Acceptable for testnets only; a real ceremony is required before any real-money deployment. See `docs/dev-ceremony-v3.md`.

## 8. Verification

Anyone can independently confirm the claims in §1–2 via the Etherscan links above, or by cloning this repository and reproducing the flow using `tools/zk-toolkit.html` and `circuits/withdraw.circom`. For the experimental track, see `circuits/withdraw_v2.circom`, `circuits/disclose.circom`, and `contracts/LatheonShieldedPoolV4.sol`. For V5, run `cd test/v5-integration && npm install && npm test`.

---

**Development principle:** working prototype → open source → public testnet → external developers → independent review and public ceremony → audited mainnet candidate. Claims about future capabilities are intentionally kept separate from what is demonstrated today.
