# Latheon

> **Private by default. Verifiable on demand.**

Latheon is an early-stage, open-source project developing privacy-preserving blockchain infrastructure using zero-knowledge proofs and selective disclosure. Today it is a set of shielded pools on Ethereum-compatible testnets; the long-term goal is an Ethereum L2 with privacy by default. The framework is Arbitrum Orbit, and the first step is running: the Latheon test chain, with test LTH as its gas coin (see [`docs/testnet.md`](./docs/testnet.md) and [`ROADMAP.md`](./ROADMAP.md)). A production chain is not running and has no date.

**Status: experimental public prototype, testnet only** (the Latheon test chain; the earlier deployments on Ethereum Sepolia, Arbitrum Sepolia and Robinhood Chain Testnet are deprecated since 27 October 2026 and frozen in our interface). The Merkle commitment tree is fully on-chain, so no trusted operator is involved in the deposit-to-withdrawal flow. There is no formal audit yet, and the trusted-setup keys are development keys. See [`STATUS.md`](./STATUS.md) for exactly what is implemented versus planned.

Follow the work: X [@Latheon_xyz](https://x.com/Latheon_xyz) · Telegram [t.me/Latheon](https://t.me/Latheon) · site [latheon.xyz](https://latheon.xyz).

---

## Try it

**Latheon test chain:** RPC `https://rpc.testnet.latheon.xyz`, chain ID 60531373273, explorer and faucet at <https://explorer.testnet.latheon.xyz>. On it you deposit LTH itself, with no approval step, and a withdrawal to an empty address leaves it with LTH for gas. Details and limits: [`docs/testnet.md`](./docs/testnet.md).

**Live demo: <https://latheon.xyz/demo>**. Pick a network and a token, claim test tokens, then either use one fixed pool, or deposit **any amount** through the router (one master key for all notes) and withdraw by **amount and master key**. You can also withdraw to another address and generate a disclosure proof for an auditor. Test tokens only, no real value. A browser wallet such as MetaMask is required.

## Current generation: V7 (on the Latheon test chain)

- **Pools:** four fixed-size pools of 100 / 50 / 10 / 1 test LTH on the Latheon test chain, paid in the chain's own coin, plus a router. Circuit `withdraw_v5`. Addresses: [`docs/testnet.md`](./docs/testnet.md); machine-readable: [`sdk/deployments.json`](./sdk/deployments.json).
- **Fixed in V7: withdrawal without a deposit.** In every earlier circuit one value in the Merkle path was not limited to 0 or 1, so a crafted proof could withdraw from a pool without any deposit. Found in an internal review, reproduced locally with test tokens, fixed in `withdraw_v5`. All older pools (V3–V6, and the V5 pools on Ethereum Sepolia, Arbitrum Sepolia and Robinhood Chain Testnet, now deprecated) are kept only for withdrawals. Our demo no longer deposits into them; the contracts themselves have no pause, still accept deposits and stay forgeable, so nobody should deposit into them (they are marked `frozen` and `forgeable` in `deployments.json`). See `STATUS.md` §7 and [`docs/dev-ceremony-v5.md`](./docs/dev-ceremony-v5.md).
- **Recipient-bound proofs:** a withdrawal proof is valid only for the address it was made for, and the relayer and its fee are bound into the proof too. The earlier V3/V4 pools lacked recipient binding, so a pending withdrawal could be redirected; this was found internally, reproduced and fixed; see [`docs/withdraw-recipient-binding.md`](./docs/withdraw-recipient-binding.md).
- **Capacity:** each pool's Merkle tree has depth 20, so a pool holds up to 1,048,576 deposits, and it keeps its last 100 roots.
- **Any amount, via a router:** `contracts/LatheonDistributionPool.sol` is a stateless contract (no owner, no fee) that splits an amount into notes of 100 / 50 / 10 / 1 and deposits them into the four pools in one transaction; `withdrawMany` pays several notes to one address in one transaction (up to 16). The current router is the V7 native router on the Latheon test chain; the routers on the three external testnets are deprecated with their pools. Not independently reviewed. Several notes withdrawn to one address in one transaction are visibly linked to each other. Details: [`docs/distribution-pool-architecture.md`](./docs/distribution-pool-architecture.md), [`docs/distribution-pool-deployments.md`](./docs/distribution-pool-deployments.md).
- **Selective disclosure:** a depositor can prove to one chosen auditor that they control a specific deposit, without giving that auditor any ability to spend it. The auditor learns which deposit it is (its commitment is public on-chain anyway), but not your keys, your other deposits, or where the funds went. Design: [`docs/selective-disclosure-design.md`](./docs/selective-disclosure-design.md).

## Do not deposit into pre-V7 pools

For anyone integrating with Latheon or calling the contracts directly: **only the V7 pools and the V7 router on the Latheon test chain are current.** Every older pool (V3, V4, V5, V6, on every network, including all pools on Ethereum Sepolia, Arbitrum Sepolia and Robinhood Chain Testnet) uses a circuit with a known flaw: a forged proof can withdraw from it without a deposit (`THREAT-MODEL.md` §8.0). The freeze is in our interface only; **the contracts have no pause, still accept deposits, and anything deposited there can be emptied by such a proof.**

- Read the flags in [`sdk/deployments.json`](./sdk/deployments.json) (same file as `demo/deployments.json`): pre-V7 pools carry `"frozen": true, "forgeable": true`, pre-V7 routers `"frozen": true`. Never deposit into a flagged entry; such entries are listed only so notes already in them can be withdrawn.
- The V3 pool on Ethereum Sepolia (`0x9d047AdA4e33D28fBd86220f3F899A7Df7e3360C`, table below) is pre-V7 too, and it is the default pool of the old JavaScript SDK's `deposit()`; see the compatibility table in [`sdk/README.md`](./sdk/README.md).
- `node tools/check-deployments.js` checks the flags and the documents (no network needed).

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
contracts/   Solidity contracts: token, faucet, pools (V3–V7; only V7 is current), distribution routers, verifiers, Poseidon hashing
circuits/    circom circuits (withdraw v1/v2/v3, disclose) and compiled proving artifacts in build/
sdk/         pool and router registry (deployments.json), distribution helpers (distribution.js), reference app for the frozen V5 pools (demo-app-v5.html, withdrawals only), JavaScript SDK (V3 pool, see its compatibility table)
demo/        the live demo (latheon.xyz/demo): index.html and deployments.json
site/        source of the landing page (latheon.xyz)
test/        Remix unit tests (V3/V4), Node integration tests with real proofs (v5-integration, distribution),
             browser end-to-end tests for the demo (demo-e2e)
tools/       zk-toolkit.html (browser trusted setup and proving), privacy-simulation (design model), check-deployments.js and check-versions.js (offline consistency checks)
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
- `cd test/distribution && npm install && npm test`: the router with real proofs on a local EVM (48 checks, a few minutes); `node wallet.js` checks the wallet-side helpers (25 checks).
- `cd test/native && npm install && npm test`: the native-coin variant of the V5 pool and the router (no ERC-20: the pools take and pay the chain's gas coin), with real proofs on a local EVM (57 checks, a few minutes). Not deployed anywhere yet.
- `node test/demo-e2e/rpc-robust.js`: the demo's log scanning against fake endpoints modelled on real ones (whole range in one request, range caps, rate limits, pruned nodes, an endpoint that is down), and that the reference app carries the same code (13 checks, no network, no packages).
- `node test/demo-e2e/landing-e2e.js`: the website's live deposit counters (9 checks, Playwright).
- `test/demo-e2e`: browser tests of the demo on local chains (reference scripts; see its README).
- Remix unit tests for V3/V4 are in `test/` (open them in Remix; no local setup).
- `tools/zk-toolkit.html` (serve it over `http://`, not `file://`) runs trusted setup and proof generation in the browser. Circuit sources are in `circuits/` and can be tried at [zkrepl.dev](https://zkrepl.dev).
- V3 contracts and the four distribution routers are verified on Sourcify; check the explorer for the status of each V5 contract.

## Contributing

Latheon is open source and welcomes contributors; see [`CONTRIBUTING.md`](./CONTRIBUTING.md) for where help is most useful right now (independent circuit review is the current top priority).

## License

MIT, see [LICENSE](./LICENSE)
