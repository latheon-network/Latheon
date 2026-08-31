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
- Public faucet.
Details and exact contract addresses: [`STATUS.md`](./STATUS.md).

---

## NEXT — Public developer testnet (target: 0–3 months)

**Protocol**
- [x] Automated test coverage for all three core contracts (18 tests, 0 failures) — see test/ in the repository.
- [ ] Independent review pass on the zero-knowledge circuit.

**Developer experience**
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

## VISION — Sovereign modular network (12–18+ months, funding-dependent)

These are long-term research directions, explicitly **not** current capabilities (see `STATUS.md` §6 for the same list with status labels):

- A dedicated Latheon consensus layer, decoupled from execution.
- DAG-based mempool with BFT finality.
- Modular data availability, including data availability sampling.
- Dual EVM + WASM execution environment.
- Native light clients for Ethereum/Bitcoin interoperability.
- Alternative proving systems (PLONK/Halo) evaluated against Groth16's trusted-setup tradeoffs.
- Role-separated node types (collators / validators / archivers) instead of one-node-does-everything.
- Dynamic, EIP-1559-style fee mechanisms and formal slashing conditions.

This phase is deliberately last. It is the reward for getting NOW/NEXT/THEN right, not a substitute for them.

---

## Funding dependency

Grant or investment funding is expected to accelerate, in order: zero-knowledge circuit review → developer tooling → public testnet infrastructure → external developer/validator onboarding → security audit. See the project's grant materials for a detailed use-of-funds breakdown.
