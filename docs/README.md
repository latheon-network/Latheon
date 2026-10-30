# Documentation index

**Start here**
- [`../STATUS.md`](../STATUS.md): what is live versus planned, labeled honestly.
- [`../THREAT-MODEL.md`](../THREAT-MODEL.md): what is protected, what is not, and the assumptions.
- [`testnet.md`](./testnet.md): the Latheon test chain: how to connect, faucet, contract addresses, measured gas, limits.
- [`deployments-v5.md`](./deployments-v5.md): addresses of the deprecated V5 pools on the three external testnets (pre-V7, frozen: withdrawals of existing notes only; machine-readable: [`../sdk/deployments.json`](../sdk/deployments.json)). The current V7 addresses are in [`testnet.md`](./testnet.md).

**Design**
- [`architecture.md`](./architecture.md): overview and current flow.
- [`selective-disclosure-design.md`](./selective-disclosure-design.md): the `spendKey` / `viewKey` split and the disclosure proof.
- [`distribution-pool-architecture.md`](./distribution-pool-architecture.md): arbitrary deposit amounts over fixed pools (design, a simulation, and the router contract).
- [`distribution-pool-deployments.md`](./distribution-pool-deployments.md): router addresses on the four testnet token sets and what was checked.
- [`bridge-privacy-design.md`](./bridge-privacy-design.md): the L1 to L2 bridge privacy problem and options.

**Security**
- [`withdraw-recipient-binding.md`](./withdraw-recipient-binding.md): the V3/V4 flaw and the V5 fix.
- [`dev-ceremony-v5.md`](./dev-ceremony-v5.md): the development keys of the current circuit (`withdraw_v5`, V7) and the pre-V7 flaw it fixes; earlier keys: [`dev-ceremony-v4.md`](./dev-ceremony-v4.md) (V6), [`dev-ceremony-v3.md`](./dev-ceremony-v3.md) (V5; also why development keys are not enough for real value).
- [`operator-rights.md`](./operator-rights.md): which key or service on the test chain can do what, and how to limit it.
- [`mainnet-readiness.md`](./mainnet-readiness.md): conditions before any real value, with their status today.

**Operations**
- [`deploying-v5.md`](./deploying-v5.md): deployment checklist for V5 pools (deprecated generation; the steps for the chain's V6/V7 sets are in `latheon-network/l2-eval-ci`, `testnet/latheon`).
- [`bridge-withdrawal-procedure.md`](./bridge-withdrawal-procedure.md): withdrawing from the test chain to Arbitrum Sepolia, step by step, and what can go wrong.
- [`incident-response.md`](./incident-response.md): what to do in an incident on the test chain.
- [`../DEPLOYMENT-CHECKLIST.en.md`](../DEPLOYMENT-CHECKLIST.en.md): the earlier V3 stack.
- [`gas-benchmark.en.md`](./gas-benchmark.en.md) / [`gas-benchmark.md`](./gas-benchmark.md): gas figures (V3/V4 era; read the update note at the top).

**Legacy (V4 generation, deprecated)**
- [`legacy/arbitrum-sepolia-addresses-and-benchmark.md`](./legacy/arbitrum-sepolia-addresses-and-benchmark.md)
- [`legacy/robinhood-chain-addresses-and-benchmark.md`](./legacy/robinhood-chain-addresses-and-benchmark.md)
