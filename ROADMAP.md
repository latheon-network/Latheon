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

## THEN — Genesis Cohort & validator testnet (target: 3–9 months)

**Developer ecosystem**
- [ ] SDK release and example integrations.
- [ ] Genesis Cohort onboarding: builders, integration partners, validator operators (tracks already open — see the project site).
- [ ] Target: 5+ external developers shipping something on Latheon.

**Validator testnet**
- [ ] Validator node specification and deployment guide.
- [ ] Monitoring and onboarding process.
- [ ] Target: 10+ external validators (a development milestone, not a guarantee).

**Privacy work**
- [ ] Circuit improvements and proof-generation benchmarks.
- [ ] Design work on a protocol-level selective disclosure mechanism (today this is a manual, off-protocol action — see `THREAT-MODEL.md` §2.5).

---

## Mainnet candidate preparation (target: 9–12 months)

- [ ] Independent security audit.
- [ ] Independent cryptographic review.
- [ ] Production hardening, monitoring, incident response.
- [ ] First real pilot integrations with partners.

---

## VISION — Ethereum L2, not a sovereign L1 (12–18+ months, funding-dependent)

**This section changed.** Earlier versions of this roadmap described a sovereign Layer 1 — Latheon's own consensus layer, validator set, and DAG-based mempool, built entirely from scratch. After weighing the realistic engineering cost against what a solo-founder, AI-assisted project can credibly deliver, the direction has changed: **Latheon's long-term vision is now an Ethereum Layer 2, not a Layer 1.**

Why this changed: building an L1's consensus and validator security from zero is a multi-year, large-team undertaking with no real precedent among small teams. An L2 built on an existing, audited rollup framework inherits Ethereum's security instead of having to bootstrap its own — a categorically smaller, more achievable problem. It also keeps our actual expertise (the privacy circuits) as the differentiator, rather than requiring us to also become a consensus-research team.

- Deploy on Ethereum mainnet as an L2, using an existing ZK-rollup framework (candidates: Polygon CDK, ZK Stack — not yet decided, see open questions below) rather than building a rollup's validity-proving engine from scratch.
- Latheon's own contracts (the shielded pool, selective disclosure mechanism) become the appchain's core application, not a separate protocol layered on someone else's general-purpose chain.
- Realistic near-term ZK-rollup properties inherited from the chosen framework: sub-second-to-seconds finality, fees far below L1 (typically single-digit cents for simple transfers on comparable rollups), and — honestly — a centralized sequencer at launch, same as virtually every production ZK rollup today. Full sequencer/prover decentralization remains an open, industry-wide problem, not something we'd solve alone.

**Open questions, not yet decided:**
- Polygon CDK (shared liquidity and tooling via AggLayer, faster to stand up) vs. ZK Stack (more sovereignty and configurability, more operational overhead) — see the framework comparison discussion, not yet resolved.
- What stays true from the old plan and what doesn't: PLONK/Halo as an alternative to Groth16 is still a reasonable question to revisit, independent of the L1→L2 change. Native light clients, a permissionless validator set, and a dedicated consensus layer are dropped — an L2 doesn't need or want its own validator set; it inherits Ethereum's.

This phase is deliberately last. It is the reward for getting NOW/NEXT/THEN right, not a substitute for them.

---

## Funding dependency

Grant or investment funding is expected to accelerate, in order: zero-knowledge circuit review → developer tooling → public testnet infrastructure → external developer/validator onboarding → security audit. See the project's grant materials for a detailed use-of-funds breakdown.
