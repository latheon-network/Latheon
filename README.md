# Latheon

> **Private by default. Verifiable on demand.**

Latheon is an early-stage, open-source project developing privacy-preserving blockchain infrastructure using zero-knowledge proofs and selective disclosure.

**Status: experimental public prototype, testnets only** (Ethereum Sepolia, Arbitrum Sepolia, Robinhood Chain Testnet). The Merkle commitment tree is fully on-chain, so no trusted operator is involved in the deposit-to-withdrawal flow. There is no formal audit yet, and the trusted-setup keys are development keys. See [`STATUS.md`](./STATUS.md) for exactly what is implemented versus planned.

---

## Try it

**Live demo: <https://latheon.xyz/demo>**. Pick a network and a pool, claim test tokens, deposit, withdraw to another address, and generate a disclosure proof for an auditor. Test tokens only, no real value. A browser wallet such as MetaMask is required.

## Current generation: V5

- **Pools:** fixed-size pools of 100 / 50 / 10 / 1 tokens on three testnets (16 pools: LTH on all three, plus USDG on Robinhood Chain). Addresses: [`docs/deployments-v5.md`](./docs/deployments-v5.md); machine-readable: [`sdk/deployments.json`](./sdk/deployments.json).
- **Recipient-bound proofs:** a withdrawal proof is valid only for the address it was made for. The earlier V3/V4 pools lacked this, so a pending withdrawal could be redirected to another address. This was found internally, reproduced and fixed; see [`docs/withdraw-recipient-binding.md`](./docs/withdraw-recipient-binding.md).
- **Capacity:** each pool's Merkle tree has depth 8, so a pool holds at most 256 deposits.
- **Selective disclosure:** a depositor can prove to one chosen auditor that they control a specific deposit, without giving that auditor any ability to spend it. The auditor learns which deposit it is (its commitment is public on-chain anyway), but not your keys, your other deposits, or where the funds went. Design: [`docs/selective-disclosure-design.md`](./docs/selective-disclosure-design.md).

## How a pool works

1. **Deposit** a fixed amount (the pool's size). Every deposit in a pool has the same size, and its commitment is inserted into the pool's **on-chain** Merkle tree in the same transaction.
2. **Withdraw** by presenting a zero-knowledge proof (Groth16, generated in your browser) that you know the secret behind a deposit in the pool, **without revealing which one**, and bound to the recipient address you choose. The contract verifies the proof on-chain against its own root history.
3. **Disclose (optional)** one deposit to one auditor with a separate proof bound to the auditor's one-time nonce.

Full mechanics and limits: [`THREAT-MODEL.md`](./THREAT-MODEL.md).

## Earlier production track: V3 (Ethereum Sepolia)

| Contract | Address | Etherscan |
|---|---|---|
| **LatheonToken (LTH)** | `0x53F7f947D150D41FecAC4e3FBE04cdD1bf19F67D` | [View](https://sepolia.etherscan.io/address/0x53F7f947D150D41FecAC4e3FBE04cdD1bf19F67D) |
| **LatheonShieldedPoolV3 (zk-SNARK, on-chain Merkle tree)** | `0x9d047AdA4e33D28fBd86220f3F899A7Df7e3360C` | [View](https://sepolia.etherscan.io/address/0x9d047AdA4e33D28fBd86220f3F899A7Df7e3360C) |
| **Groth16Verifier** | `0x5E4D51352153513A9085e4e65B8541f393E4D470` | [View](https://sepolia.etherscan.io/address/0x5E4D51352153513A9085e4e65B8541f393E4D470) |
| **PoseidonT3 (hashing library)** | `0x33bA81C2f2ef705910Ee7022d8e2481eD83aDD1B` | [View](https://sepolia.etherscan.io/address/0x33bA81C2f2ef705910Ee7022d8e2481eD83aDD1B) |

> V3 and V4 pools are deprecated: they lack the recipient binding described above. They remain deployed for history.

## Repository structure

```
contracts/   Solidity contracts: token, faucet, pools (V3, V4, V5), verifiers, Poseidon hashing
circuits/    circom circuits (withdraw v1/v2/v3, disclose) and compiled proving artifacts in build/
sdk/         demo app (demo-app-v5.html), pool registry (deployments.json), JavaScript SDK (V3 pool)
site/        source of the landing page (latheon.xyz)
test/        Remix unit tests (V3/V4), Node integration tests with real proofs (v5-integration),
             reference browser end-to-end test (demo-e2e)
tools/       zk-toolkit.html (browser trusted setup and proving), privacy-simulation (design model)
docs/        technical documentation, see docs/README.md
```

## Documentation

- [Current Status](./STATUS.md): what is live versus planned, labeled honestly
- [Documentation index](./docs/README.md)
- [Architecture](./docs/architecture.md)
- [Privacy & Threat Model](./THREAT-MODEL.md)
- [Roadmap](./ROADMAP.md)
- [Contributing](./CONTRIBUTING.md)
- [Security Policy](./SECURITY.md)

## Verify it yourself

- `cd test/v5-integration && npm install && npm test`: 19 checks with real proofs on a local EVM (about a minute). It includes a reproduction of the V3/V4 flaw and a demonstration that V5 rejects it.
- Remix unit tests for V3/V4 are in `test/` (open them in Remix; no local setup).
- `tools/zk-toolkit.html` (serve it over `http://`, not `file://`) runs trusted setup and proof generation in the browser. Circuit sources are in `circuits/` and can be tried at [zkrepl.dev](https://zkrepl.dev).
- V3 contracts are verified on Sourcify and Blockscout; check the explorer for the status of each V5 contract.

## Contributing

Latheon is open source and welcomes contributors; see [`CONTRIBUTING.md`](./CONTRIBUTING.md) for where help is most useful right now (independent circuit review is the current top priority).

## License

MIT, see [LICENSE](./LICENSE)
