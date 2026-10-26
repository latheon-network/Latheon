# Latheon — Current Status

> Private by default. Verifiable on demand.

**Status:** Experimental public prototype
**Networks:** the Latheon test chain (our own Arbitrum Orbit chain on Arbitrum Sepolia), Ethereum Sepolia, Arbitrum Sepolia and Robinhood Chain Testnet (all testnets)
**Stage:** Public test chain, early; prototype contracts, no audit

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

The V3 source code is verified on Sourcify and Blockscout — inspect it directly from the Etherscan links above.

**LatheonFaucet (🟢 LIVE):** anyone can call `claim()` to receive 500 test LTH, once every 24 hours per address — no need to request tokens from the team directly. Funded with 50,000 LTH at launch (100 claims).

**Test coverage (🟢 LIVE):** all three core contracts above — LatheonToken, LatheonFaucet, LatheonShieldedPoolV3 — have automated Solidity unit tests (18 checks total, all passing), runnable directly in Remix with no local setup. Pool tests use a mock verifier to test contract logic (deposits, root tracking, double-spend prevention) independently of the real cryptography, which is separately confirmed by the actual on-chain proof already verified on Sepolia.

**Developer SDK and reference app (🟢 LIVE):** a JavaScript SDK (`sdk/`) automates commitment/nullifier computation and Merkle proof construction from on-chain events — the part that previously required manually reading `zeros()` and `roots()` by hand. `sdk/demo-app-v5.html` is a real, wallet-connected reference application: connect MetaMask, claim from the faucet, deposit, and withdraw, with the Merkle path built automatically. A full deposit → withdraw cycle through this app has been executed and confirmed on Sepolia — not a mockup.

**Live counters (🟢 LIVE):** the website shows, per network, how many deposits the V5 pools hold, read from the pool contracts themselves (`nextIndex()`, via the network's RPC). The earlier Blockscout activity feed was removed with the redesign; Blockscout's transaction counter was not used because deposits made through the router are internal calls it does not count, and its index of Arbitrum Sepolia is incomplete.

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
- **Verified:** 48 automated checks with real proofs on a local EVM (`test/distribution`), plus one manual deposit of 11 units and one `withdrawMany` of two notes with real proofs on each of the four token sets. Router balance and allowances were zero afterwards. All four routers are source-verified on Sourcify (exact match).
- **Wallet side and demo (built):** the demo deposits any amount through the router (user chooses exact or rounded-down amount, one master key for all notes) and withdraws by amount and master key (notes chosen to match the amount exactly, proofs made in the browser, one `withdrawMany` transaction, batches of 16). Helpers are in `sdk/distribution.js` (`test/distribution/wallet.js`, 25 checks); the browser flow is tested in `test/demo-e2e/router-e2e.js` (36 checks, local chains). Run live on Ethereum Sepolia: a 23-note deposit, then withdrawals of 17, 5 and 1 notes. On 11 October 2026 the released demo (v21) was run live on all four token sets: a router deposit and withdrawals by amount and master key on Ethereum Sepolia (16 notes; withdrawals of 5 and 11 notes), Arbitrum Sepolia (16; 14 and 2), Robinhood Chain LTH (17; 13 and 4) and USDG (3; 2 and 1), plus a disclosure checked in the auditor tab, with no RPC errors. Log scanning in the demo asks for a pool's whole block range in one request where the endpoint allows it, splits a range the endpoint refuses, retries transient errors, and checks the result against the pool's own deposit count (`nextIndex()`) before building a proof (`test/demo-e2e/rpc-robust.js`, 13 checks). Checked live on 10 October 2026: all 16 V5 pools read completely in about a second per network. On Ethereum Sepolia, `ethereum-sepolia-rpc.publicnode.com` often answers "pruned history unavailable" for event logs, while the public `sepolia.gateway.tenderly.co` keeps full history but rate-limits bursts (about 10 requests at once); so event logs are read from Tenderly (`logsRpcUrl` in `deployments.json`), every other call from publicnode, and Blockscout's logs API is the last fallback. Reads are limited to 8 at once per endpoint and retried on transient errors; withdrawals are sent with fee caps of twice the latest base fee plus the tip, so a base fee that rose while proofs were made does not get the transaction refused (seen once on Arbitrum Sepolia).
- **Not done:** pool-activity indicators and a planner that proposes several addresses and delays (design D2 and D4); no independent review; `withdrawMany` pays one address, so it is a convenience and does not add privacy (the notes of one withdrawal are visibly linked). Design: `docs/distribution-pool-architecture.md`.

## 2c. Latheon test chain (🟢 LIVE, testnet, opened 20 October 2026)

Our own chain: an Arbitrum Orbit chain settling to Arbitrum Sepolia (Rollup mode), chain ID 60531373273, with **test LTH as its gas coin**. Public RPC `https://rpc.testnet.latheon.xyz`, explorer and faucet at `https://explorer.testnet.latheon.xyz`. How to connect, all addresses and the limits: [`docs/testnet.md`](./docs/testnet.md).

- **Contracts:** the native-coin V5 pools (100 / 50 / 10 / 1 LTH) and the native-coin router, with the same `withdraw_v3` verifier and the disclosure verifier, built from commit `180b4b8`. After deployment every link was checked on-chain (native-coin marker, verifier and denomination of each pool, Poseidon linking, the router's pools and limits) and each verifier accepted a real proof; the withdrawal verifier rejected the same proof for another recipient.
- **Confirmed by transactions with real proofs (20 October 2026):** a scripted run deposited 11 LTH through the router as 2 notes and withdrew both with one `withdrawMany` to an empty address, which received exactly 11 LTH; a disclosure proof verified on-chain. Then, by hand in the demo: a fixed-pool deposit and its withdrawal, a disclosure checked in the auditor tab, a 6-note router deposit and withdrawals of 5 and 1 notes.
- **Measured gas (scripted run):** router deposit of 2 notes 815,774 execution / 10,121,111 total; `withdrawMany` of 2 notes 554,474 / 30,273,597. The total includes the charge for publishing data to Arbitrum Sepolia, more than 90% of it; at the chain's 0.1 gwei that is about 0.001 and 0.003 LTH.
- **Operation:** one rented server (node, Blockscout explorer, faucet, HTTPS proxy with per-IP rate limits), a single sequencer and a single validator run by us; the validator posts and confirms assertions on Arbitrum Sepolia, so withdrawals to Arbitrum Sepolia can be claimed once the batch is posted, an assertion covers it and the challenge period has passed (about two hours in total at today's low traffic, measured 24 October 2026). External checks every 15 minutes. Setup and rehearsals: `latheon-network/l2-eval-ci`, folder `testnet/`.
- **Withdrawal relayer (🟢 LIVE since 21 October 2026):** at `https://explorer.testnet.latheon.xyz/relay/api`, the demo can hand the proof to a relayer run by the chain, which sends the withdrawal from its own address and pays the gas, so no wallet is needed and the user's wallet does not appear in the withdrawal. It accepts only this chain's pools and router, simulates every request before sending (anything the chain would reject is refused without spending gas), and limits requests per IP and per day; no fee. It cannot change the recipient, which is bound to the proof. Confirmed live: a one-note withdrawal sent by the relayer, `0x9df07aeab9ab5c8f598cec3b0d3450d47950cd6872f19ae0836b319868875aa2` (17,082,144 gas in total, including the data charge). On 22 October, a 562 LTH router deposit as 9 notes (`0x85b6f379627c665bf45347388ce191ffbe5839ea12515206dcc20e9786713ded`, 21,530,020 gas in total) was withdrawn by amount and master key in two relayed `withdrawMany` calls: 5 notes, `0x49895d124df76e1a375fa5db050b7c0ed3e2e907b4e068ecb47daa0e075d2dcf` (66,494,237 gas in total), and 4 notes, `0x6af721b059a594fb1b0bc4972e4d4df6464e592e9d09d937f7823e04b70cd6a9` (55,822,675 gas in total). Local tests: 15 checks with real proofs (`latheon-network/l2-eval-ci`, `testnet/relayer`); demo, `test/demo-e2e/native-e2e.js` (16). The relayer sees the recipient and the client's IP address.
- **Bridge page (🟢 LIVE since 24 October 2026):** `bridge/index.html`, served at `https://latheon.xyz/bridge`, moves test LTH between Arbitrum Sepolia and the chain from the user's wallet: deposit (`approve` for exactly the amount, then `depositERC20` on the inbox; the page waits for the coin to arrive) and withdrawal (`ArbSys.withdrawEth` on the chain, then, once the assertion is confirmed, `Outbox.executeTransaction` on Arbitrum Sepolia; the page lists withdrawals, shows when they can be claimed and sends the claim). It reads its addresses from the `bridge` entry in `deployments.json`. Confirmed live on 24 October 2026, a round trip of 100 LTH: deposit `0x675a28b257e8043a624151f743a5335cf8e5b115702b82012a0529f4d6fcebc0` (Arbitrum Sepolia; arrived on the chain in under a minute), withdrawal `0x83f2217456539e0e3d87ff93bd2b8a2debb8babc070e4e74b97024d33320180e` (on the chain; 6,115,326 gas in total, including the data charge), claim `0x8e7f11941b7a665a14518ef3a7b22a5cfa86939917892189073889eeeaa29a0c` (Arbitrum Sepolia, outbox `0x61615B1b8493df67846C6BF17ab2EC4Fcb1775f7`), about two hours after the withdrawal; a 10 LTH round trip the same day also went through. Local test `test/demo-e2e/bridge-e2e.js`: 18 checks with stand-in bridge contracts. Bridging is public: it links the Arbitrum Sepolia address to the same address on the chain. Wallets whose own RPC endpoint for Arbitrum Sepolia is unreliable fail to send ("could not coalesce error"); setting the official endpoint fixed it in our test.
- **Not yet:** a multisig over the chain's owner powers (one development key today), any independent review.

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

- **V6: larger pools and the relayer fee in the proof (built and tested locally; not deployed yet; not reviewed independently).** A V5 pool holds at most 256 deposits (tree depth 8) and keeps the last 30 roots; on a busy chain the smallest pool would fill first and proofs would go stale. V6 uses a new circuit, `circuits/withdraw_v4.circom` (11,934 constraints, development keys from a single-party setup, `docs/dev-ceremony-v4.md`): tree depth 20, so a pool holds 1,048,576 deposits, and two more public inputs, `relayer` and `fee`, so a relayer's fee is bound into the proof like the recipient. Contracts: `LatheonShieldedPoolV6` / `LatheonShieldedPoolV6Native` (100 kept roots; pay `fee` to `relayer` and the rest to `recipient`) and `LatheonDistributionPoolV6` / `LatheonDistributionPoolV6Native` (per-note fee, one relayer per batch). Notes keep the V5 format; the disclosure circuit is unchanged. Splitting deposits over several pools of the same size was rejected because it would shrink each withdrawal's anonymity set. Tests: `test/native-v6` (the native V5 suite adapted, plus capacity past 256, root history and relayer-fee checks), the demo in V6 mode (`V6=1 node test/demo-e2e/native-e2e.js`, 16 checks), and the relayer's tests in `latheon-network/l2-eval-ci` (25 checks with real proofs). Measured on a local EVM: a one-note deposit costs 866,776 gas (V5: 427,228) and a withdrawal 310,789; through the V6 router a 32-note deposit costs 21,850,278 gas (682,821 per note) and a 3-note withdrawMany 849,042. Gas on the Latheon test chain is measured separately after deployment. The demo and the relayer handle V5 and V6 side by side, so notes in V5 pools stay withdrawable. If many deposits land in a pool between proving and sending, so that the pool no longer knows the proof's root ("Unknown root"), the demo scans again and makes a new proof on its own, for one note and for withdrawals by amount (tested in `native-e2e.js` N16 and N17 by putting 30 or 100 deposits into the pool mid-withdrawal).
- **Native-coin variant of the V5 pool and the router (deployed on the Latheon test chain, §2c; not reviewed independently).** `contracts/LatheonShieldedPoolV5Native.sol` and `contracts/LatheonDistributionPoolNative.sol`: the same circuit (`withdraw_v3`), verifier, tree, nullifiers and recipient binding as V5, but the pools take and pay the chain's native coin instead of an ERC-20. Meant for a chain whose gas token is the coin users hold: no wrapping, no approve, and a withdrawal to an empty address leaves it with coin it can pay gas with. `withdraw()` records the nullifier before it pays; a recipient that refuses the coin makes the withdrawal revert and the note stays spendable. `test/native`: 57 checks with real proofs on a local EVM, including refusing and re-entering recipients and coin forced in with `selfdestruct`. Measured there: `deposit()` 427,228 gas for 1 note and 9,415,048 for 32; `withdrawMany()` 304,120 gas for 1 note and 554,462 for 2 (empty recipient addresses). Not reviewed independently. The demo handles such pools when a network lists its coin as native in `deployments.json` (deposit with the coin itself, no approval step, the network added to the wallet with that coin): `test/demo-e2e/native-e2e.js`, 15 checks with real proofs on a local chain. The Latheon test chain is listed in `deployments.json` this way.

## 5. Near-term targets (🔵 TARGET)

- Genesis Cohort: **paused, not closed.** No onboarding is happening and the sign-up form is off the website for now; the program is meant for external builders and integration partners (the validator-operator track is on hold, see `ROADMAP.md`).
- Independent review of the zero-knowledge circuit(s).
- Security audit ahead of any mainnet consideration.
- A decision on whether/how the selective-disclosure track (§3) merges into the production track, once it's fully tested.

## 6. Long-term vision (⚪ VISION) — Latheon's own chain on Arbitrum Orbit

**Framework decided in October 2026: Arbitrum Orbit** (earlier: a sovereign L1, then an Ethereum L2 with the framework under evaluation). The test chain in §2c is the first step; a production chain is not running and has no date. Decisions taken (gas token LTH, funds originating on the chain, gas-free withdrawals through a relayer, stealth addresses after the testnet, staged control of the chain from a multisig with a timelock to a security council and holder votes) and questions still open (where the production chain settles, Rollup vs AnyTrust, self-hosting vs a provider, the launch stablecoin, bridge privacy, the proving system) are listed in [`ROADMAP.md`](./ROADMAP.md), VISION. A production chain comes only after independent circuit review, a public trusted-setup ceremony and an audit.

## 7. Known limitations

- No formal third-party security audit has been performed, on either track.
- The circuits and contracts have had limited external review.
- This is a solo-founder prototype built with AI-assisted development, not yet a funded team effort.
- Metadata (transaction timing, gas usage) remains publicly visible on-chain — see `THREAT-MODEL.md` for the full picture of what is and isn't protected.
- **Production track (V3):** selective disclosure today means sharing your `secret` directly, which also grants spending power — see §3 above and `docs/selective-disclosure-design.md` for the fix, which is now working on a separate experimental track.
- **Experimental track (V4):** confirmed working end-to-end on testnet, with automated test coverage now in place, but has had no independent security review yet.
- **Known issue (V3/V4 pools):** the withdrawal recipient is not bound to the zero-knowledge proof, so a pending withdrawal can be front-run by replaying the proof with a different recipient. Reproduced in testing; fixed in V5 (`circuits/withdraw_v3.circom`, `contracts/LatheonShieldedPoolV5.sol`). V5 pools are now deployed on the Ethereum Sepolia, Arbitrum Sepolia and Robinhood Chain testnets (`docs/deployments-v5.md`); the older V3/V4 pools stay deployed but are deprecated. Every pool is testnet-only. See `docs/withdraw-recipient-binding.md`.
- **Gas figures** in `docs/gas-benchmark*.md` date from V3/V4; live V5 readings differ and one is unexplained, see the update note at the top of those files. Since 6 October 2026 Ethereum Sepolia runs the Glamsterdam upgrade (EIP-8037 pricing of new state), so contract deployments and new storage cost several times more gas there than before; Sepolia readings after that date are not comparable with mainnet or L2s. This explains the 10.39M-gas router deployment, not the earlier V5 withdrawal reading.
- **Pool capacity and anonymity:** each V5 pool's Merkle tree has depth 8, so a pool holds at most 256 deposits, and it keeps 30 roots, so a proof is refused once 30 more deposits land in the same pool before it is sent. V6 (§4) raises these to 1,048,576 deposits and 100 roots. Pools hold mostly test deposits, so anonymity sets are small today.
- **Latheon test chain (§2c):** one server, one sequencer and one validator, all run by us; nobody else can challenge its assertions, and its owner powers (chain, rollup upgrades, test LTH) sit with one development key. It can be down or reset. See `docs/testnet.md`.
- **LTH is a test token** with no monetary value. The owner can mint more (`LatheonToken.mint`, `onlyOwner`).
- **Trusted setup:** all current key material comes from single-operator setups, not a public multi-party ceremony. Acceptable for testnets only; a real ceremony is required before any real-money deployment. See `docs/dev-ceremony-v3.md`.

## 8. Verification

Anyone can independently confirm the claims in §1–2 via the Etherscan links above, or by cloning this repository and reproducing the flow using `tools/zk-toolkit.html` and `circuits/withdraw.circom`. For the experimental track, see `circuits/withdraw_v2.circom`, `circuits/disclose.circom`, and `contracts/LatheonShieldedPoolV4.sol`. For V5, run `cd test/v5-integration && npm install && npm test`. For the router, `test/distribution`; for the native-coin variant, `test/native` (same commands).

---

**Development principle:** working prototype → open source → public testnet → external developers → independent review and public ceremony → audited mainnet candidate. Claims about future capabilities are intentionally kept separate from what is demonstrated today.
