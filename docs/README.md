# Documentation index

**Start here**
- [`../STATUS.md`](../STATUS.md): what is live versus planned, labeled honestly.
- [`../THREAT-MODEL.md`](../THREAT-MODEL.md): what is protected, what is not, and the assumptions.
- [`testnet.md`](./testnet.md): the Latheon test chain: how to connect, faucet, contract addresses, measured gas, limits.
- [`deployments-v5.md`](./deployments-v5.md): addresses of the deprecated V5 pools on the three external testnets (pre-V7, frozen: withdrawals of existing notes only; machine-readable: [`../sdk/deployments.json`](../sdk/deployments.json)). The current V7 addresses are in [`testnet.md`](./testnet.md).

**Design**
- [`architecture.md`](./architecture.md): overview and current flow.
- [`selective-disclosure-design.md`](./selective-disclosure-design.md): the `spendKey` / `viewKey` split and the disclosure proof.
- [`v8-design.md`](./v8-design.md): the next circuit and contract revision in one step (proof bound to chain and pool, domain tags, `disclose_link` for receipts and reserves, extData hash, optional association set), with measured constraint counts and proof times of prototypes (`../circuits/drafts/v8/`). Draft, nothing decided.
- [`disclosure-v2-design.md`](./disclosure-v2-design.md): disclosure scope chosen by the user, many notes at once, and where withdrawn funds went. Layers 1 and 1b (the report for an accountant or auditor) are built and released on the site since 1 November 2026; the `disclose_withdrawal` circuit (layer 2) and standing view access are design only.
- [`disclosure-report-format.md`](./disclosure-report-format.md): specification of the disclosure report file (version 1): members, what a valid file proves and does not, the checking steps, security notes, reference implementation (`sdk/src/report.js`, `tools/verify-report.js`) and test vectors.
- [`distribution-pool-architecture.md`](./distribution-pool-architecture.md): arbitrary deposit amounts over fixed pools (design, a simulation, and the router contract).
- [`distribution-pool-deployments.md`](./distribution-pool-deployments.md): router addresses on the four external testnet token sets (deprecated, withdrawals only) and what was checked; the current V7 router is in [`testnet.md`](./testnet.md).
- [`bridge-privacy-design.md`](./bridge-privacy-design.md): the L1 to L2 bridge privacy problem and options.

**Security**
- [`withdraw-recipient-binding.md`](./withdraw-recipient-binding.md): the V3/V4 flaw and the V5 fix.
- [`dev-ceremony-v5.md`](./dev-ceremony-v5.md): the development keys of the current circuit (`withdraw_v5`, V7) and the pre-V7 flaw it fixes; earlier keys: [`dev-ceremony-v4.md`](./dev-ceremony-v4.md) (V6), [`dev-ceremony-v3.md`](./dev-ceremony-v3.md) (V5; also why development keys are not enough for real value).
- [`self-review-2026-11-06.md`](./self-review-2026-11-06.md): pre-audit self-review of the V7 contracts and circuits with Slither, Aderyn and Circomspect (internal, not an audit): every tool finding triaged against the source, hardening items for the next contract version.
- [`withdraw-without-our-interface.md`](./withdraw-without-our-interface.md): how to withdraw if our page or relayer refuses (your own copy of the page, the SDK from your wallet, a proof without a relayer), and what still depends on the test chain's operator.
- [`operator-rights.md`](./operator-rights.md): which key or service on the test chain can do what, and how to limit it.
- [`mainnet-readiness.md`](./mainnet-readiness.md): conditions before any real value, with their status today.

**Operations**
- [`deploying-v5.md`](./deploying-v5.md): deployment checklist for V5 pools (deprecated generation; the steps for the chain's V6/V7 sets are in `latheon-network/l2-eval-ci`, `testnet/latheon`).
- [`bridge-withdrawal-procedure.md`](./bridge-withdrawal-procedure.md): withdrawing from the test chain to Arbitrum Sepolia, step by step, and what can go wrong.
- [`incident-response.md`](./incident-response.md): what to do in an incident on the test chain.
- Load tests on the test chain (simulations, our own wallets): [`loadtest-2026-10-27.md`](./loadtest-2026-10-27.md) (V6), [`loadtest-2026-10-29-v7.md`](./loadtest-2026-10-29-v7.md) (V7, privacy heuristics), [`loadtest-2026-10-31-throughput.md`](./loadtest-2026-10-31-throughput.md) (throughput: deposits, relayer).
- [`../DEPLOYMENT-CHECKLIST.en.md`](../DEPLOYMENT-CHECKLIST.en.md): the earlier V3 stack.
- [`legacy/gas-benchmark.en.md`](./legacy/gas-benchmark.en.md) / [`legacy/gas-benchmark.md`](./legacy/gas-benchmark.md): gas figures of the first track (V3/V4, history; current V7 figures are in STATUS.md and docs/testnet.md).

**Legacy (V4 generation, deprecated)**
- [`legacy/arbitrum-sepolia-addresses-and-benchmark.md`](./legacy/arbitrum-sepolia-addresses-and-benchmark.md)
- [`legacy/robinhood-chain-addresses-and-benchmark.md`](./legacy/robinhood-chain-addresses-and-benchmark.md)
