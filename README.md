# Latheon

> **Private by default. Verifiable on demand.**

Latheon is an early-stage, open-source project developing privacy-preserving blockchain infrastructure using zero-knowledge proofs and selective disclosure.

**Status: experimental public prototype**, live on Ethereum Sepolia. See [`STATUS.md`](./STATUS.md) for exactly what's implemented today versus what's planned.

---

## Live on Sepolia Testnet

| Contract | Address | Etherscan |
|---|---|---|
| **LatheonToken (LTH)** | `0x53F7f947D150D41FecAC4e3FBE04cdD1bf19F67D` | [View](https://sepolia.etherscan.io/address/0x53F7f947D150D41FecAC4e3FBE04cdD1bf19F67D) |
| **LatheonShieldedPool (zk-SNARK)** | `0x22dEe9507b9a00A12bc6aB8B63Ab5CD3868543e4` | [View](https://sepolia.etherscan.io/address/0x22dEe9507b9a00A12bc6aB8B63Ab5CD3868543e4) |
| **Groth16Verifier** | `0xB38399602B6Fd721E371abAD675a6f28BB3E7344` | [View](https://sepolia.etherscan.io/address/0xB38399602B6Fd721E371abAD675a6f28BB3E7344) |

> ⚠️ Sepolia is a public **testnet**. Tokens have no real-world value. This is experimental software with no formal audit yet — see [`SECURITY.md`](./SECURITY.md).

## How the shielded pool works

1. **Deposit** exactly 100 LTH into the pool. Every deposit is identical in size, so no amount is ever leaked.
2. **Withdraw** by presenting a zero-knowledge proof (Groth16, generated off-chain) showing you know a secret tied to a deposit in the pool — without revealing which one. The contract verifies the proof on-chain and releases funds to any address you choose.
3. **Verify later, selectively** — the depositor can share their secret with an auditor or partner at any time, who can independently confirm the deposit happened, without the network ever having seen it.

Full mechanics, what's protected, and what isn't: [`THREAT-MODEL.md`](./THREAT-MODEL.md).

**Honest current limitation:** the record of deposits is still updated off-chain by the pool owner rather than automatically on-chain after every deposit. This is a deliberate, disclosed simplification while an on-chain hashing implementation is developed (see [`ROADMAP.md`](./ROADMAP.md)) — it does not weaken the privacy guarantee of a withdrawal itself, which is already fully verified on-chain.

## Repository structure

```
contracts/   Solidity smart contracts
circuits/    circom zero-knowledge circuit (withdraw proof)
tools/       Browser-based ZK toolkit — trusted setup, proof generation,
             verification, and Solidity verifier export, no install required
docs/        Technical documentation
```

## Documentation

- [Current Status](./STATUS.md) — what's live vs. planned, labeled honestly
- [Architecture](./docs/architecture.md)
- [Privacy & Threat Model](./THREAT-MODEL.md)
- [Roadmap](./ROADMAP.md)
- [Contributing](./CONTRIBUTING.md)
- [Security Policy](./SECURITY.md)

## Try it yourself

- Open `tools/zk-toolkit.html` via a local web server (see comments in the file — it needs `http://`, not a direct `file://` open, due to browser CORS) to run trusted setup and generate your own proof
- Circuit source: `circuits/withdraw.circom` — testable directly in [zkrepl.dev](https://zkrepl.dev), no install needed
- Contracts are verified on Sourcify and Blockscout — source code is visible directly from the Etherscan links above

## Contributing

Latheon is open source and welcomes contributors — see [`CONTRIBUTING.md`](./CONTRIBUTING.md) for where help is most useful right now (the on-chain Merkle tree is the current top priority).

## License

MIT — see [LICENSE](./LICENSE)
