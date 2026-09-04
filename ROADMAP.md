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
- [ ] Expanded contract test coverage, invariant and fuzz testing.
- [ ] Independent review pass on the zero-knowledge circuit.

**Developer experience**
- [ ] Public faucet.
- [ ] Block explorer integration.
- [ ] Deployment automation and reproducible build instructions.
- [ ] Developer documentation and an initial SDK.

**Open source foundation**
- [x] Contributing guide, security policy, threat model.
- [ ] Good-first-issue backlog.

**Target outcome:** an external developer can use the testnet without direct help from the core team.

---

## THEN — Genesis Cohort growth (target: 3–9 months)

**This section changed too, following the L1→L2 decision.** The original "Validator testnet" subsection assumed Latheon would need its own validator set — that's no longer the plan. An Ethereum L2 inherits Ethereum's validator security; it doesn't bootstrap its own. That entire subsection is dropped rather than carried forward stale.

**Developer ecosystem**
- [x] ~~SDK release and example integrations~~ — done, see `STATUS.md` §1 (`sdk/`, `sdk/demo-app.html`, tested end-to-end on Sepolia).
- [ ] Genesis Cohort onboarding: builders, integration partners (the "validator operators" track is on hold pending clarity on what, if anything, node operation means for an L2 built on Polygon CDK — see `ROADMAP.md` VISION section).
- [ ] Target: 5+ external developers shipping something on Latheon.

**Privacy work**
- [x] ~~Design work on a protocol-level selective disclosure mechanism~~ — done and live. `LatheonShieldedPoolV4` implements the spendKey/viewKey split described in `docs/selective-disclosure-design.md`; both the withdrawal and the disclosure proof are tested end-to-end on Sepolia. See `STATUS.md` §3. This is no longer a manual, off-protocol action for the experimental track — it remains manual only on the production V3 track, which V4 is intended to eventually replace once independently reviewed.
- [ ] Proof-generation timing benchmark — instrumentation added to `tools/zk-toolkit.html` (see `docs/gas-benchmark.en.md`), but a real measurement hasn't been recorded yet. Gas costs are already benchmarked from real transactions; generation time is the one number still missing.

---

## Mainnet candidate preparation (target: 9–12 months)## Mainnet candidate preparation (target: 9–12 months)

- [ ] Independent security audit.
- [ ] Independent cryptographic review.
- [ ] Production hardening, monitoring, incident response.
- [ ] First real pilot integrations with partners.

---

## VISION — Ethereum L2 on Polygon CDK, not a sovereign L1 (12–18+ months, funding-dependent)

**This section changed twice.** Earlier versions described a sovereign Layer 1 — Latheon's own consensus layer, validator set, and DAG-based mempool, built entirely from scratch. That was replaced with a general "Ethereum L2" direction, framework undecided. Both the framework and the practical deployment path are now decided.

Why L2, not L1: building an L1's consensus and validator security from zero is a multi-year, large-team undertaking with no real precedent among small teams. An L2 built on an existing, audited rollup framework inherits Ethereum's security instead of having to bootstrap its own. It also keeps our actual expertise (the privacy circuits) as the differentiator, rather than requiring us to also become a consensus-research team.

**Framework: Polygon CDK.** Chosen over ZK Stack for four reasons: faster realistic path to launch for a small team, a dedicated Polygon CDK offering specifically for compliance-oriented chains (directly matching our institutional/banking target segment), a recent (2026) sharp drop in proof-generation cost and time that removes the old "not viable for low-volume chains" objection, and no imposed protocol-level fees to a third party — the chain operator captures value from activity directly, which matters for the monetization model.

**Practical deployment path: a Rollup-as-a-Service (RaaS) provider, not Polygon Labs directly or self-hosting.** As of 2026, Polygon positions CDK itself as an enterprise, sales-led product ("work with Polygon to design and launch a bespoke chain; CDK is the product, not a self-serve kit") rather than a simple self-serve toolkit. Self-hosting is technically possible but requires serious dedicated infrastructure — the prover node alone has been documented needing a 96-core CPU and 740 GB RAM, well beyond what a solo-founder project can reasonably run itself. A RaaS provider (e.g. Zeeve) offers a genuinely self-serve configuration dashboard — chain name, settlement layer, DA layer, gas config, region — and operates the expensive proving infrastructure as part of a subscription, which is the realistic path at our current stage.

**Mode and DA layer: Validium (or a cheaper external DA provider), chosen deliberately at this stage — not a setting to revisit casually later.** Polygon's own documentation identifies the rollup-vs-validium choice as the first and most foundational design decision a CDK chain makes: validium mode requires an entirely separate smart contract (for the Data Availability Committee) and separate infrastructure, not a configuration flag on the same contracts. No source describes a supported way to migrate a live chain with real users and state from one mode to the other — in practice, changing this later would mean launching a new chain and migrating liquidity, the same kind of undertaking as our own V3→V4 pool migration, just at the level of an entire chain instead of one contract. Given we're early-stage and cost currently matters more to us than maximal security guarantees, we're choosing the cheaper option now, with eyes open about how hard it would be to change later.

**Gas token: LTH**, Latheon's own token, rather than ETH or a stablecoin — consistent with capturing value from chain activity directly rather than routing it through a third-party token.

- Latheon's own contracts (the shielded pool, selective disclosure mechanism) become the appchain's core application, not a separate protocol layered on someone else's general-purpose chain.
- Realistic near-term properties: fast "trusted" transaction confirmation in the range of a few seconds (not sub-second — see the corrected claim in `docs/gas-benchmark.en.md`), full L1-anchored finality on the order of minutes to hours depending on batch/proof timing, fees in the fractions-of-a-cent range, and — honestly — a centralized sequencer at launch, same as virtually every production ZK rollup today. Full sequencer/prover decentralization remains an open, industry-wide problem, not something we'd solve alone.

**Still genuinely open, not yet solved:**
- **Bridge privacy leakage.** Funding an L2 wallet via a standard bridge from an L1 address can link an identity to that address before any shielded deposit happens on L2, undermining the exact guarantee Latheon exists to provide. Possible mitigations worth evaluating: (a) users acquire L2-native funds directly rather than bridging a linkable L1 address, (b) the pool's own liquidity moves between L1 and L2 as aggregate treasury transfers rather than per-user bridging, (c) a shielded/privacy-preserving bridge design (harder, more novel engineering, unproven at scale). Until resolved, this should be documented as an explicit user-facing caveat, not silently assumed away — see `THREAT-MODEL.md`.
- **Exact timing of the L1→L2 transition.** The current V3/V4 prototypes on Ethereum L1 keep working as-is; nothing here changes them. When and how a production chain launch happens is a separate, later decision, realistically after independent circuit review.
- PLONK/Halo as an alternative to Groth16 is still a reasonable question to revisit, independent of this decision.

Native light clients, a permissionless validator set, and a dedicated consensus layer are dropped from the earlier plan — an L2 doesn't need or want its own validator set; it inherits Ethereum's.

This phase is deliberately last. It is the reward for getting NOW/NEXT/THEN right, not a substitute for them.

---

## Funding dependency

Grant or investment funding is expected to accelerate, in order: zero-knowledge circuit review → developer tooling → public testnet infrastructure → external developer/validator onboarding → security audit. See the project's grant materials for a detailed use-of-funds breakdown.
