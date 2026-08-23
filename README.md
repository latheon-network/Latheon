# Latheon

> **Private by default. Verifiable on demand.**

Latheon is an early-stage, open-source project developing privacy-preserving blockchain infrastructure using zero-knowledge proofs and selective disclosure.

**Status: experimental public prototype**, live on Ethereum Sepolia, with a fully on-chain Merkle commitment tree — no trusted operator anywhere in the deposit-to-withdrawal flow. See [`STATUS.md`](./STATUS.md) for exactly what's implemented today versus what's planned.

---

## Live on Sepolia Testnet

| Contract | Address | Etherscan |
|---|---|---|
| **LatheonToken (LTH)** | `0x53F7f947D150D41FecAC4e3FBE04cdD1bf19F67D` | [View](https://sepolia.etherscan.io/address/0x53F7f947D150D41FecAC4e3FBE04cdD1bf19F67D) |
| **LatheonShieldedPoolV3 (zk-SNARK, on-chain Merkle tree)** | `0x9d047AdA4e33D28fBd86220f3F899A7Df7e3360C` | [View](https://sepolia.etherscan.io/address/0x9d047AdA4e33D28fBd86220f3F899A7Df7e3360C) |
| **Groth16Verifier** | `0x5E4D51352153513A9085e4e65B8541f393E4D470` | [View](https://sepolia.etherscan.io/address/0x5E4D51352153513A9085e4e65B8541f393E4D470) |
| **PoseidonT3 (hashing library)** | `0x33bA81C2f2ef705910Ee7022d8e2481eD83aDD1B` | [View](https://sepolia.etherscan.io/address/0x33bA81C2f2ef705910Ee7022d8e2481eD83aDD1B) |

> ⚠️ Sepolia is a public **testnet**. Tokens have no real-world value. This is experimental software with no formal audit yet — see [`SECURITY.md`](./SECURITY.md).

## How the shielded pool works

1. **Deposit** exactly 100 LTH into the pool. Every deposit is identical in size, so no amount is ever leaked. The deposit's commitment is inserted into the pool's **on-chain** Merkle tree in the same transaction.
2. **Withdraw** by presenting a zero-knowledge proof (Groth16, generated off-chain) showing you know a secret tied to a deposit in the pool — without revealing which one. The contract verifies the proof on-chain, against its own known-root history, and releases funds to any address you choose.
3. **Verify later, selectively** — the depositor can share their secret with an auditor or partner at any time, who can independently confirm the deposit happened, without the network ever having seen it.

Full mechanics: [`THREAT-MODEL.md`](./THREAT-MODEL.md).

**No trusted operator anywhere in this flow.** The Merkle tree updates automatically on-chain with every deposit, using the same Poseidon hash the zero-knowledge circuit relies on — see [`ROADMAP.md`](./ROADMAP.md) for what's next.

## Repository structure

```
contracts/   Solidity smart contracts (token, shielded pool, verifier, Poseidon hashing)
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

Latheon is open source and welcomes contributors — see [`CONTRIBUTING.md`](./CONTRIBUTING.md) for where help is most useful right now (independent circuit review and public testnet infrastructure are the current priorities).

## License

MIT — see [LICENSE](./LICENSE)
