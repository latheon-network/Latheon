# Latheon

**Private by default. Verifiable on demand.**

Latheon is a modular network prototype for the real economy — banks, marketplaces, logistics, and everyday users. Every transaction is encrypted by default; the sender chooses when and with whom to share proof of it.

This repository contains the working smart contracts and zero-knowledge circuit behind the current prototype, live on the Sepolia testnet.

---

## Live on Sepolia Testnet

| Contract | Address | Etherscan |
|---|---|---|
| **LatheonToken (LTH)** | `0x53F7f947D150D41FecAC4e3FBE04cdD1bf19F67D` | [View](https://sepolia.etherscan.io/address/0x53F7f947D150D41FecAC4e3FBE04cdD1bf19F67D) |
| **LatheonShieldedPool (zk-SNARK)** | `0x22dEe9507b9a00A12bc6aB8B63Ab5CD3868543e4` | [View](https://sepolia.etherscan.io/address/0x22dEe9507b9a00A12bc6aB8B63Ab5CD3868543e4) |
| **Groth16Verifier** | `0xB38399602B6Fd721E371abAD675a6f28BB3E7344` | [View](https://sepolia.etherscan.io/address/0xB38399602B6Fd721E371abAD675a6f28BB3E7344) |

> ⚠️ Sepolia is a public **testnet**. Tokens have no real-world value.

## How the shielded pool works

1. **Deposit** exactly 100 LTH into the pool. Every deposit is identical in size, so no amount is ever leaked.
2. **Withdraw** by presenting a zero-knowledge proof (Groth16, generated off-chain) showing you know a secret tied to a deposit in the pool — without revealing which one. The contract verifies the proof on-chain and releases funds to any address you choose.
3. **Verify later, selectively** — the depositor can share their secret with an auditor or partner at any time, who can independently confirm the deposit happened, without the network ever having seen it.

**Honest current limitation:** the record of deposits is still updated off-chain by the pool owner rather than automatically on-chain after every deposit. This is a deliberate simplification while an on-chain hashing implementation is developed — it does not weaken the privacy guarantee of a withdrawal itself, which is already fully verified on-chain.

## Repository structure

```
contracts/   Solidity smart contracts
circuits/    circom zero-knowledge circuit (withdraw proof)
tools/       Browser-based ZK toolkit — trusted setup, proof generation,
             verification, and Solidity verifier export, no install required
docs/        Step-by-step build logs, kept as a transparent record of how
             this prototype was built
```

## Try it yourself

- Open `tools/zk-toolkit.html` in a local web server (see comments in the file) to run trusted setup and generate your own proof
- Circuit source: `circuits/withdraw.circom` — testable directly in [zkrepl.dev](https://zkrepl.dev), no install needed
- Contracts are verified on Sourcify and Blockscout — source code is visible directly from the Etherscan links above

## License

MIT — see [LICENSE](./LICENSE)
