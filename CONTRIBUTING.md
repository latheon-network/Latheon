# Contributing to Latheon

Thanks for your interest in contributing. Latheon is an early-stage, open-source project building privacy-preserving blockchain infrastructure with zero-knowledge proofs. It is currently a solo-founder prototype — external contributions are genuinely welcome and will directly shape what gets built next.

Before diving in, please read [`STATUS.md`](./STATUS.md) so you know exactly what's live today versus in development.

## Areas where we need contributors

**Zero-knowledge**
Circom circuits, Groth16 proving/verification, circuit testing, proof-generation performance.

**Smart contracts**
Solidity, independent review of the zero-knowledge circuit (the current top priority — see `ROADMAP.md`), security testing, gas optimization.

**Developer tooling**
TypeScript/JavaScript, SDK development, example applications, wallet integrations.

**Testnet infrastructure**
Explorer integration, deployment automation, monitoring.

**Documentation**
Tutorials, examples, architecture write-ups.

## Getting started

```bash
git clone https://github.com/latheon-network/latheon.git
cd latheon
```

The circuit in `circuits/withdraw.circom` can be tested directly in the browser at [zkrepl.dev](https://zkrepl.dev) — no local install needed. `tools/zk-toolkit.html` runs a full trusted-setup-to-proof pipeline locally in your browser; see comments in the file for how to serve it locally (it needs to be run from a local web server, not opened directly as a file, due to browser CORS restrictions).

## Finding an issue

Good starting points are issues labeled `good first issue`, `documentation`, `help wanted`, `zk`, `contracts`, or `tooling`. For larger features, please open or comment on an issue before starting implementation so effort isn't duplicated.

## Pull requests

Please keep PRs focused, documented, and tested where applicable. In the description, explain:

1. What changed
2. Why the change is needed
3. How it was tested
4. Whether there are security or privacy implications

## Security-sensitive changes

Changes touching circuits, proof verification, commitments, nullifiers, withdrawal logic, or access control need extra review. See [`SECURITY.md`](./SECURITY.md) — do not disclose vulnerabilities via public issues.

## Code of conduct

Communicate respectfully and constructively. The goal is reliable, honestly-documented open-source infrastructure — not maximizing contribution counts.

## License

MIT, unless a specific component states otherwise.
