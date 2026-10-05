# Documentation index

**Start here**
- [`../STATUS.md`](../STATUS.md): what is live versus planned, labeled honestly.
- [`../THREAT-MODEL.md`](../THREAT-MODEL.md): what is protected, what is not, and the assumptions.
- [`deployments-v5.md`](./deployments-v5.md): current pool addresses on the three testnets (machine-readable: [`../sdk/deployments.json`](../sdk/deployments.json)).

**Design**
- [`architecture.md`](./architecture.md): overview and current flow.
- [`selective-disclosure-design.md`](./selective-disclosure-design.md): the `spendKey` / `viewKey` split and the disclosure proof.
- [`distribution-pool-architecture.md`](./distribution-pool-architecture.md): arbitrary deposit amounts over fixed pools (design only, with a simulation).
- [`bridge-privacy-design.md`](./bridge-privacy-design.md): the L1 to L2 bridge privacy problem and options.

**Security**
- [`withdraw-recipient-binding.md`](./withdraw-recipient-binding.md): the V3/V4 flaw and the V5 fix.
- [`dev-ceremony-v3.md`](./dev-ceremony-v3.md): how the current development keys were made, and why they are not enough for real value.

**Operations**
- [`deploying-v5.md`](./deploying-v5.md): deployment checklist for V5 pools.
- [`../DEPLOYMENT-CHECKLIST.en.md`](../DEPLOYMENT-CHECKLIST.en.md): the earlier V3 stack.
- [`gas-benchmark.en.md`](./gas-benchmark.en.md) / [`gas-benchmark.md`](./gas-benchmark.md): gas figures (V3/V4 era; read the update note at the top).

**Legacy (V4 generation, deprecated)**
- [`legacy/arbitrum-sepolia-addresses-and-benchmark.md`](./legacy/arbitrum-sepolia-addresses-and-benchmark.md)
- [`legacy/robinhood-chain-addresses-and-benchmark.md`](./legacy/robinhood-chain-addresses-and-benchmark.md)
