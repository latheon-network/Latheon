# Distribution router: testnet deployments

**Status:** deployed on four testnet token sets and checked by hand with real proofs. **Testnets only, test tokens, no independent review.**
Contract: `contracts/LatheonDistributionPool.sol` (v2, with `withdrawMany`). Design and tests: `docs/distribution-pool-architecture.md`.
The router is stateless (no owner, no fee, no upgrade path) and never keeps tokens. The V5 pools it points to are the existing ones and are unchanged.

| Network | Token | Router (v2) | Block | Deploy gas |
|---|---|---|---|---|
| Arbitrum Sepolia (421614) | LTH `0x16b87f399a003E56eA6A680292b7278Df7D7b655` | `0x284985291A32cf0cfE48F6CA128615983952350e` | 317439163 | 1,576,220 |
| Robinhood Chain Testnet (46630) | LTH `0x19DAD9E8595b5809a600c42273aC2a8360c15BA3` | `0x006da9E656581A7740856aA89c690b3Abd296c30` | 131756119 | 1,576,208 |
| Robinhood Chain Testnet (46630) | USDG, 6 decimals `0x7E955252E15c84f5768B83c41a71F9eba181802F` | `0xded64ec452C95bA69Fe80d51447cb8c4953E52C0` | 131766479 | 1,576,220 |
| Ethereum Sepolia (11155111) | LTH `0x53F7f947D150D41FecAC4e3FBE04cdD1bf19F67D` | `0xC12095a1e7fAc20E827a93933576469e1122eB61` | 11879141 | 10,390,714 (confirmed on-chain; Glamsterdam pricing, see below) |

Deployment transaction on Ethereum Sepolia: `0x5d2b4aec63a3ac3fc70a968ff5e4cd5e89e084d09aaeaf24e20850024796f97b` (9 October 2026, 18:27 UTC).

### Why the Ethereum Sepolia deployment used 10.39M gas

Ethereum Sepolia activated the Glamsterdam upgrade on 6 October 2026 (13:53:36 UTC), three days before this deployment. Glamsterdam includes EIP-8037, which charges new state at `CPSB` = 1,530 gas per byte: 120 bytes for a new account, 64 bytes for a new storage slot and one byte per byte of deployed code. Arbitrum Sepolia and Robinhood Chain Testnet keep their own gas schedules and were not affected.

| State created by the deployment | Calculation | Gas |
|---|---|---|
| Runtime code, 5,980 bytes | 5,980 × 1,530 | 9,149,400 |
| New contract account | 120 × 1,530 | 183,600 |
| 8 new storage slots (`pools[4]`, `denominations[4]`) | 8 × 64 × 1,530 | 783,360 |
| **State gas** | | **10,116,360** |
| Remainder: calldata (about 8.5 KB of init code) and constructor execution | 10,390,714 − 10,116,360 | about 274,000 |

The remainder is in line with what such a transaction costs to execute. Under the earlier schedule the same bytecode cost 1,576,220 gas on the other networks, 1,196,000 of it for the code at 200 gas per byte. The split above is calculated from the bytecode, not read from the chain (explorers report one total). The same pricing explains why the router's `deposit` and `withdrawMany` on Ethereum Sepolia (both run after the fork) cost more than on the other networks: both create new storage (tree nodes, root history, nullifiers).

An earlier build without `withdrawMany` was deployed on Arbitrum Sepolia at `0x0a45b66f0Ba9463a834d19f3A7e325024D6f9946`. It is **replaced** by the v2 router above and should not be used.

## Pools behind each router (largest first: 100, 50, 10, 1)

| Set | Pools |
|---|---|
| Arbitrum Sepolia, LTH | `0x5E81DB3aE24B5B6d7E4d853933EF37b55d2ccDC7`, `0xded64ec452C95bA69Fe80d51447cb8c4953E52C0`, `0xe41964e7A9CBc9E2fE618a09a3692e8430c25cA5`, `0x4480012096726C670A2C89E05AA37DF7258EF26a` |
| Robinhood, LTH | `0x9d047AdA4e33D28fBd86220f3F899A7Df7e3360C`, `0x288b8E0281b85118135F7bd55902f7167EAe5169`, `0x362ceAD7a6bB1b99a69b6Eebc75e37a42d82F5F6`, `0x24a394Fe56464A79A63Adbc57B785d599c3c0074` |
| Robinhood, USDG | `0x6513862b2153c6AFd56C00B798a859548b0181e7`, `0xF4ab260E65D7c6bEE3D1192d2Cef677199B1f214`, `0xaA16653312E033623a6CD0D1f7DEFDFc21f30461`, `0xc5C7Aa68BF65df8c7877809C21ceaa7E881ed1C4` |
| Ethereum Sepolia, LTH | `0x851981f6a35EB0D91d927c0e854774f5d0ce6233`, `0x09d3D081195304FD83bb79e4b5B97344cE5e89b4`, `0x4402b051482B0304A118A4F8A8bb10095127499D`, `0x640A19F322d7D13779AcF8d64f64Efb3fF2cf876` |

## What was checked on each network

1. After deployment, read back `token()`, `POOL_COUNT()`, `MAX_NOTES()` (32), `MAX_WITHDRAWALS()` (16), `pools(i)`, `denominations(i)` and `split()` for 160, 99 and 11 units.
2. `approve` for 11 units, then `deposit(11 units, 2 commitments)`: one note of 10 and one of 1. The logs show an exact approval and transfer to each pool, then `Distributed(depositor, 11 units, 2)`.
3. One `withdrawMany` with two real Groth16 proofs (pool index 2 and 3) to the depositor's address. The logs show each pool paying the recipient directly, then `WithdrawnMany(recipient, 2)`.

| Network | Deposit tx (gas) | `withdrawMany` tx (gas) |
|---|---|---|
| Arbitrum Sepolia | `0xa43b87b59443b2e2885fb88f43edb12352726a344b418a953101f96e8b65ebfe` (638,252) | `0x912e987198d021ff42808b17f2e3a6c888911fb159b8b9f5b75640f9b5f0069b` (537,688) |
| Robinhood, LTH | `0x3ac3fe6bb7d02c63136bf5cda7e1768d8b91f70b171be6099624ef4a9f035a1f` (677,505) | `0x895f8c87139ebe825c5781e03025d717f275bc899a4389b57d460ba499998e80` (537,664) |
| Robinhood, USDG | `0xd9a41e8b36c739251a42abd366fbda6b1b7d11831608dab2c33aa734f3398a6e` (701,857) | `0x40a3f66d84b9939036d74677bd5915a52deef170ff687e36604a27bc283573d7` (555,658) |
| Ethereum Sepolia | `0x7a224e3b83122fd599bb4d71a683aab7d52c41ac36b5a8c8562484fa3dc61911` (1,523,102) | `0xfd5da67cd680bb85f43d8ced0d0ed092d5a8354be9f2549c0ec9d81772589456` (717,484) |

## Limits of this evidence

- Gas figures are the ones Remix printed ("transaction cost"); the Ethereum Sepolia deployment figure was confirmed against the transaction receipt. They are not comparable across networks: each network accounts for and prices gas differently, and since 6 October 2026 Ethereum Sepolia also prices new state under EIP-8037 (see above).
- After the run, the router's token balance and its allowances to the pools were read back and were zero on all four networks (reported by the operator; the transcript of these reads is not included here).
- Source verification: all four routers are verified on Sourcify with an exact match of both creation and runtime bytecode (checked through the Sourcify API on 10 October 2026). Blockscout also shows the Ethereum Sepolia router as verified.
- One manual run per network, one pair of notes each. This is not an audit, and the V5 pools and circuit have had no independent review either.
