# Latheon Roadmap

> Working prototype → Public testnet → Developer network → Independent review and public ceremony → Audited mainnet candidate

This roadmap uses the same NOW / NEXT / THEN / VISION framing as the project's investor and grant briefing, so both documents tell one consistent story.

---

## NOW — Working prototype, fully on-chain privacy (🟢 status: live)

- LTH token deployed on Ethereum Sepolia.
- Shielded pool deployed, using fixed-denomination deposits.
- **On-chain Merkle commitment tree** — deposits update the tree automatically, in the same transaction, using an on-chain Poseidon hash. No operator or off-chain step involved. *(This item has moved here from NEXT — it is now complete.)*
- Groth16 verifier deployed, checking proofs against the pool's own on-chain root history.
- A complete shielded withdrawal — deposit, on-chain tree update, off-chain proof, on-chain verification, withdrawal to an unlinked address — demonstrated end-to-end on Sepolia.
- Contracts, circuit, and tooling published as open source.
- **V5 pools** (recipient-bound proofs, pool size as a constructor parameter) deployed on Ethereum Sepolia, Arbitrum Sepolia and Robinhood Chain testnets, with integration tests using real proofs in `test/v5-integration`. See `docs/deployments-v5.md`. **Deprecated on 27 October 2026:** like every pool before V7 they carry the circuit flaw described in `STATUS.md` §7, so deposits into them are frozen in our interface and they are kept only for withdrawals of existing notes. The project focuses on the Latheon test chain; V7 is not planned on these three networks.

- **Latheon test chain** (Arbitrum Orbit on Arbitrum Sepolia, test LTH as gas) with public RPC, explorer, faucet, relayer and bridge page. The current pools are **V7** (circuit `withdraw_v5`, 20-level trees, relayer fee bound into the proof), live since 27 October 2026 and confirmed with real proofs; V7 fixes a flaw present in every earlier circuit (withdrawal without a deposit, found in an internal review). The older V5 and V6 pools on the chain are frozen for deposits and kept for withdrawals. See [`docs/testnet.md`](./docs/testnet.md).

Details and exact contract addresses: [`STATUS.md`](./STATUS.md).

---

## NEXT — Public developer testnet (target: 0–3 months)

**Protocol**
- [x] ~~Expanded contract test coverage, invariant and fuzz testing~~ — done. 27 automated tests, 0 failures, across production and disclosure tracks (plus 19 integration checks with real proofs for V5). See `STATUS.md` §1 and §2a.
- [ ] Independent review pass on the zero-knowledge circuit. External, funding/partner-dependent.

**Developer experience**
- [x] ~~Public faucet~~ — done, live. `LatheonFaucet`, 500 test LTH per address every 24h.
- [x] ~~Block explorer integration~~ — done. The website shows live deposit counts per network, read from the pool contracts (`nextIndex()`); explorer links on the site and in the demo.
- [x] ~~Deployment automation and reproducible build instructions~~ — done. See `DEPLOYMENT-CHECKLIST.en.md`.
- [x] ~~Developer documentation and an initial SDK~~ — done for the V3 pool. See `sdk/`, including a wallet-connected reference app tested end-to-end. The SDK's proof helpers still target V3 (pre-V7, forgeable) and its reference app handles only the frozen V5/V4 pools; what works with V7 today is listed in the compatibility table of `sdk/README.md`. The V7 update is the open item under THEN.

**Open source foundation**
- [x] Contributing guide, security policy, threat model.
- [ ] Good-first-issue backlog (not started).

**Target outcome:** an external developer can use the testnet without direct help from the core team. **6 of 8 items above are done. Two remain: the independent circuit review (external, not something we can close ourselves) and the good-first-issue backlog.**

---

## THEN — Genesis Cohort growth (paused, not closed)

**This section changed too, following the L1→L2 decision.** The original "Validator testnet" subsection assumed Latheon would need its own validator set — that's no longer the plan. An Ethereum L2 inherits Ethereum's validator security; it doesn't bootstrap its own. That entire subsection is dropped rather than carried forward stale.

**Developer ecosystem**
- [x] ~~SDK release and example integrations~~ — done for V3/V5 on the external testnets, see `STATUS.md` §1 (`sdk/`, `sdk/demo-app-v5.html`, tested end-to-end on Sepolia). Not published to npm. Those pools are now frozen, so for V7 this is open again: see the SDK item below.
- [ ] Genesis Cohort onboarding: builders, integration partners. **The program is paused, not closed: no onboarding is happening and the sign-up form is off the website for now.** (The "validator operators" track is on hold pending clarity on what, if anything, node operation means for the chain — see the VISION section.)
- [ ] Target: 5+ external developers shipping something on Latheon.

**Privacy work**
- [x] ~~Design work on a protocol-level selective disclosure mechanism~~ — done and live. `LatheonShieldedPoolV4` implements the spendKey/viewKey split described in `docs/selective-disclosure-design.md`; both the withdrawal and the disclosure proof are tested end-to-end on Sepolia. See `STATUS.md` §3. This is no longer a manual, off-protocol action for the experimental track — it remains manual only on the production V3 track, which V4 is intended to eventually replace once independently reviewed.
- [ ] Public multi-party trusted-setup ceremony. The circuit must be frozen first; new keys mean new verifiers and pools. Required before any real-value deployment (`docs/dev-ceremony-v3.md`).
- [x] Distribution router for arbitrary deposit amounts (`deposit` and `withdrawMany`): deployed on four testnet token sets and checked by hand, not reviewed independently (`docs/distribution-pool-architecture.md`, `docs/distribution-pool-deployments.md`).
- [x] Wallet-side note selection and the deposit rounding choice in the demo (exact or rounded down, user's choice; one master key; withdrawal by amount and key). Built and tested on local chains, run live on Ethereum Sepolia. Still open: pool-activity indicators and a planner that proposes several addresses and delays (`docs/distribution-pool-architecture.md`, D2 and D4).
- [ ] Update the JavaScript SDK for V7 (it currently targets the V3 pool; see the compatibility table in `sdk/README.md`). Has today: the router helpers in `sdk/distribution.js` (deposit planning, master key, note selection; the demo uses the same code), the nullifier hash, the zero values and the tree reading for any generation. Missing: `spendKey` / `viewKey` commitments, 20-level Merkle paths in the high-level helper, native-coin deposits, the V7 `withdraw` / `withdrawMany` calls with recipient, relayer and fee, proof generation for `withdraw_v5`, disclosure proofs, reading pools from `deployments.json` and refusing pools marked `frozen` / `forgeable`. Until then the reference for V7 is `demo/index.html`.
- [ ] Retire the frozen pools (V3–V6 and the three external testnets) from the demo and `deployments.json` once their remaining test notes are withdrawn. What is still inside them can be read with `testnet/legacy-pools-check.sh` in `latheon-network/l2-eval-ci` (read-only). `node tools/check-deployments.js` checks that every pre-V7 entry carries the flags and that no document shows a frozen pool next to a deposit instruction.
- [ ] Next pool and router version (also the basis for the L2 contracts), from the internal review of 27 October 2026 (`THREAT-MODEL.md` §8.5): require `0 < commitment < p` on deposit, pay the recipient with limited gas and without copying return data, and let `withdrawMany` skip a note someone else already withdrew instead of reverting the whole batch. Open question: a pause for deposits, so a pool with a known flaw can be closed in the contract and not only in our interface; it needs someone allowed to pause (an owner or a timelocked multisig), which today's pools deliberately do not have.
- [ ] Fix the comments in the next contract version: the NatSpec and header comments of the V7 contracts still name V6 in places (`node tools/check-versions.js` lists them). The deployed V7 contracts are not edited, because their bytecode was built from commit `129a4c0` and any change to the source changes the metadata hash.
- [ ] Re-measure gas on V7 on the Latheon test chain under controlled conditions (two consecutive withdrawals); see the note in `docs/gas-benchmark.en.md`. The earlier per-network V5 plan is dropped with the external testnets.
- [ ] Proof-generation timing, partly done: `docs/gas-benchmark.en.md` records 0.44 s in the browser for the `withdraw_v2` circuit (device not recorded). Still missing: the current circuit (`withdraw_v5`), a named device, and phones.

---

## Mainnet candidate preparation (target: 9–12 months)

- [ ] Independent security audit.
- [ ] Independent cryptographic review.
- [ ] Production hardening, monitoring, incident response.
- [ ] First real pilot integrations with partners.

---

## VISION — Latheon's own chain on Arbitrum Orbit (12–18+ months to a production chain, funding-dependent)

**Decision (October 2026): the framework is Arbitrum Orbit.** Earlier versions of this section described a sovereign Layer 1 (dropped: no precedent for small teams), then a general "Ethereum L2, framework under evaluation". The evaluation was done in practice, not only on paper: the full V5 stack was run on Arbitrum Sepolia, on a local Arbitrum chain with a custom gas token, and on a test chain we created ourselves (below). Arbitrum Orbit was chosen as the path of least resistance for a small team: mature, audited rollup code; a chain can be created and run without special hardware; and a custom gas token is supported. Our own expertise — the privacy circuits and pools — stays the differentiator.

**What exists today (testnet only, no audit):** the Latheon test chain, an Arbitrum Orbit chain settling to Arbitrum Sepolia (Rollup mode), with test LTH as its gas coin, a public RPC, a block explorer, a faucet, and the V7 pools and the distribution router built for the chain's native coin (deposits are made with the coin itself, no wrapping, no approval); the older V5/V6 pools there are frozen for deposits. Withdrawals with real proofs to empty addresses have been confirmed by transactions. It runs on one rented server with a single sequencer and a single validator, both operated by us; nobody else can challenge its assertions yet. Details, addresses and limits: `STATUS.md`.

**Design decisions taken:**
- **Gas token: LTH**, not ETH or a stablecoin.
- **Funds originate on the chain.** LTH and one stablecoin are meant to be available on the chain at launch, so users are not pushed to bridge from a linkable L1 address. A user-facing private bridge is not needed for launch; the first post-launch bridge feature is a one-way "bridge pool" (deposit into a pool on L1, withdraw on the chain with the same withdrawal proof).
- **Gas-free withdrawals (running on the test chain since 21 October 2026).** A relayer run by the chain submits withdrawals, so an empty address can receive funds without first holding gas (proofs are already bound to the recipient, so the relayer cannot redirect them). A relayer fee inside the proof comes with the circuit revision before the public ceremony.
- **Stealth addresses** (ERC-5564 / ERC-6538 style) are the first privacy feature planned after the testnet.
- **Control of the chain, in stages:** a multisig with a timelock over every upgrade and chain-owner power at launch; then a security council with a majority of outside members; later, ordinary upgrades by LTH holders through a timelock, with the council keeping emergency powers. Today, on the test chain, these powers sit with a single development key — acceptable for a testnet only.
- **Exit to L1:** the standard (slow) Arbitrum withdrawal always remains; a faster exit, served from part of the treasury held on L1 or by an existing fast bridge, is the intended direction, limited by available liquidity.

**Still genuinely open, not yet decided:**
- **Where the production chain settles** (an L3 on Arbitrum One or an L2 on Ethereum), **Rollup vs AnyTrust** data availability, and **self-hosting vs a Rollup-as-a-Service provider**. On the test chain more than 90% of the gas charged is the cost of publishing data to the parent chain, so this choice drives user fees more than anything else.
- **The launch stablecoin:** a regulated, issuer-freezable stablecoin, or one that cannot be frozen (which most likely means one issued on the chain itself, with its own peg and liquidation risks). Measures against freezing depend on this choice.
- **Bridge privacy** in general (see `docs/bridge-privacy-design.md`): the depositor's address is always public; privacy means a withdrawal cannot be linked to its deposit. Until the bridge design above is built, this is an explicit user-facing caveat, not something silently assumed away — see `THREAT-MODEL.md`.
- **Optional compliance tooling** such as association sets (in the style of Privacy Pools): whether it is mandatory or voluntary, and who maintains the lists.
- **Proving system.** Groth16 over BN254 is not post-quantum secure; PLONK/Halo, STARK-based proving and protocol-level proof aggregation on Ethereum (EIP-8288, a draft) are watched, see `THREAT-MODEL.md` §9.1.
- **Timing.** No production launch date is set. A production chain comes after independent circuit review, a public trusted-setup ceremony and an audit. The pools on Ethereum Sepolia, Arbitrum Sepolia and Robinhood Chain Testnet are deprecated (27 October 2026): frozen for deposits in our interface, kept only for withdrawals of existing notes.

Realistic properties, as on virtually every production rollup today: confirmation by the sequencer within a few seconds, finality on the parent chain in minutes to hours, low fees, and a centralized sequencer at launch. Full sequencer decentralization remains an open, industry-wide problem, not something we would solve alone. Native light clients, a permissionless validator set and a dedicated consensus layer are dropped from the earlier plan: the chain inherits the security of the chain it settles to.

This phase is deliberately last. It is the reward for getting NOW/NEXT/THEN right, not a substitute for them.

---

## Funding dependency

Grant or investment funding is expected to accelerate, in order: zero-knowledge circuit review → developer tooling → public testnet infrastructure → external developer onboarding → security audit. See the project's grant materials for a detailed use-of-funds breakdown.
