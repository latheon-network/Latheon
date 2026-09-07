# Latheon Roadmap

> Working prototype → Public testnet → Developer network → Validator network → Audited mainnet candidate

This roadmap uses the same NOW / NEXT / THEN / VISION framing as the project's investor and grant briefing, so both documents tell one consistent story.

---

## NOW — Working prototype, fully on-chain privacy (🟢 status: live)

- LTH token deployed on Ethereum Sepolia.
- Shielded pool deployed, using fixed-denomination deposits.
- **On-chain Merkle commitment tree** — deposits update the tree automatically, in the same transaction, using an on-chain Poseidon hash. No operator or off-chain step involved. *(This item has moved here from NEXT — it is now complete.)*
- Groth16 verifier deployed, checking proofs against the pool's own on-chain root history.
- A complete shielded withdrawal — deposit, on-chain tree update, off-chain proof, on-chain verification, withdrawal to an unlinked address — demonstrated end-to-end on Sepolia.
- Contracts, circuit, and tooling published as open source.

Details and exact contract addresses: [`STATUS.md`](./STATUS.md).

---

## NEXT — Public developer testnet (target: 0–3 months)

**Protocol**
- [x] ~~Expanded contract test coverage, invariant and fuzz testing~~ — done. 27 automated tests, 0 failures, across production and disclosure tracks. See `STATUS.md` §1.
- [ ] Independent review pass on the zero-knowledge circuit. **The one remaining item in this entire section.**

**Developer experience**
- [x] ~~Public faucet~~ — done, live. `LatheonFaucet`, 500 test LTH per address every 24h.
- [x] ~~Block explorer integration~~ — done. Live on-chain activity feed on the website, pulling real-time data from Blockscout.
- [x] ~~Deployment automation and reproducible build instructions~~ — done. See `DEPLOYMENT-CHECKLIST.en.md`.
- [x] ~~Developer documentation and an initial SDK~~ — done. See `sdk/`, including a real, wallet-connected demo app tested end-to-end.

**Open source foundation**
- [x] Contributing guide, security policy, threat model.
- [ ] Good-first-issue backlog.

**Target outcome:** an external developer can use the testnet without direct help from the core team. **Five of six items above are done — independent circuit review is the only gap, and it's external (funding/partner-dependent), not something we can close ourselves.**

---

## THEN — Genesis Cohort growth (target: 3–9 months)

**This section changed too, following the L1→L2 decision.** The original "Validator testnet" subsection assumed Latheon would need its own validator set — that's no longer the plan. An Ethereum L2 inherits Ethereum's validator security; it doesn't bootstrap its own. That entire subsection is dropped rather than carried forward stale.

**Developer ecosystem**
- [x] ~~SDK release and example integrations~~ — done, see `STATUS.md` §1 (`sdk/`, `sdk/demo-app.html`, tested end-to-end on Sepolia).
- [ ] Genesis Cohort onboarding: builders, integration partners (the "validator operators" track is on hold pending clarity on what, if anything, node operation means for an L2 built on a framework not yet finalized — see `ROADMAP.md` VISION section).
- [ ] Target: 5+ external developers shipping something on Latheon.

**Privacy work**
- [x] ~~Design work on a protocol-level selective disclosure mechanism~~ — done and live. `LatheonShieldedPoolV4` implements the spendKey/viewKey split described in `docs/selective-disclosure-design.md`; both the withdrawal and the disclosure proof are tested end-to-end on Sepolia. See `STATUS.md` §3. This is no longer a manual, off-protocol action for the experimental track — it remains manual only on the production V3 track, which V4 is intended to eventually replace once independently reviewed.
- [ ] Proof-generation timing benchmark — instrumentation added to `tools/zk-toolkit.html` (see `docs/gas-benchmark.en.md`), but a real measurement hasn't been recorded yet. Gas costs are already benchmarked from real transactions; generation time is the one number still missing.

---

## Mainnet candidate preparation (target: 9–12 months)

- [ ] Independent security audit.
- [ ] Independent cryptographic review.
- [ ] Production hardening, monitoring, incident response.
- [ ] First real pilot integrations with partners.

---

## VISION — Ethereum L2, framework under evaluation (12–18+ months, funding-dependent)

**This section changed twice, and is being kept deliberately open a bit longer before a third, public commitment.** Earlier versions described a sovereign Layer 1 — dropped, no precedent for small teams. Then: a general "Ethereum L2" direction. The framework itself is still being validated in practice, not just on paper, before we name a final choice publicly.

Why L2, not L1: building an L1's consensus and validator security from zero is a multi-year, large-team undertaking with no real precedent among small teams. An L2 built on an existing, audited rollup framework inherits Ethereum's security instead of having to bootstrap its own. It also keeps our actual expertise (the privacy circuits) as the differentiator, rather than requiring us to also become a consensus-research team.

**Framework: actively being evaluated, not yet finalized.** A ZK-native framework with a dedicated compliance-oriented chain offering (matching our institutional/banking target segment) remains the leading candidate on paper. Rather than deciding from documentation alone, we're also gaining direct, hands-on experience within other ecosystems — including participating in Arbitrum's builder programs — before naming a final choice. A framework decided only from reading about it, without ever having built anything on the alternatives, isn't a decision we're comfortable publishing yet.

**Deployment path considerations:** self-hosting rollup infrastructure requires serious dedicated hardware (prover nodes for some frameworks have been documented needing a 96-core CPU and 740 GB RAM) — well beyond what a solo-founder project can reasonably run itself. A managed Rollup-as-a-Service provider is the realistic path at our current stage, regardless of which framework we land on.

**Mode and DA layer:** whichever framework is chosen, the rollup-vs-validium choice is typically the first and most foundational decision — often requiring separate contracts and infrastructure per mode, with no standard supported way to migrate a live chain between them later. Cost currently matters more to us than maximal security guarantees at this stage, which will inform this choice once the framework itself is settled.

**Gas token: LTH**, Latheon's own token, rather than ETH or a stablecoin — consistent with capturing value from chain activity directly rather than routing it through a third-party token. This holds regardless of framework.

- Latheon's own contracts (the shielded pool, selective disclosure mechanism) become the appchain's core application, not a separate protocol layered on someone else's general-purpose chain.
- Realistic near-term properties, true across the frameworks under consideration: fast "trusted" transaction confirmation in the range of a few seconds (not sub-second — see the corrected claim in `docs/gas-benchmark.en.md`), full L1-anchored finality on the order of minutes to hours depending on batch/proof timing, fees in the fractions-of-a-cent range, and — honestly — a centralized sequencer at launch, same as virtually every production rollup today. Full sequencer/prover decentralization remains an open, industry-wide problem, not something we'd solve alone.

**Still genuinely open, not yet solved:**
- **Bridge privacy leakage.** Funding an L2 wallet via a standard bridge from an L1 address can link an identity to that address before any shielded deposit happens on L2, undermining the exact guarantee Latheon exists to provide. Possible mitigations worth evaluating: (a) users acquire L2-native funds directly rather than bridging a linkable L1 address, (b) the pool's own liquidity moves between L1 and L2 as aggregate treasury transfers rather than per-user bridging, (c) a shielded/privacy-preserving bridge design (harder, more novel engineering, unproven at scale). Until resolved, this should be documented as an explicit user-facing caveat, not silently assumed away — see `THREAT-MODEL.md`.
- **Exact timing of the L1→L2 transition.** The current V3/V4 prototypes on Ethereum L1 keep working as-is; nothing here changes them. When and how a production chain launch happens is a separate, later decision, realistically after independent circuit review.
- PLONK/Halo as an alternative to Groth16 is still a reasonable question to revisit, independent of this decision.

Native light clients, a permissionless validator set, and a dedicated consensus layer are dropped from the earlier plan — an L2 doesn't need or want its own validator set; it inherits Ethereum's.

This phase is deliberately last. It is the reward for getting NOW/NEXT/THEN right, not a substitute for them.

---

## Funding dependency

Grant or investment funding is expected to accelerate, in order: zero-knowledge circuit review → developer tooling → public testnet infrastructure → external developer/validator onboarding → security audit. See the project's grant materials for a detailed use-of-funds breakdown.
