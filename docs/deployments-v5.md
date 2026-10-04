# V5 deployments (testnets)

All V5 pools share the same source (`LatheonShieldedPoolV5.sol`), differing only in the `denomination` constructor argument. Proofs are bound to the recipient address (see `docs/withdraw-recipient-binding.md`). Keys are development keys (see `docs/dev-ceremony-v3.md`): **testnet only**.

Machine-readable version: `sdk/deployments.json` (the demo reads it at runtime, so adding a pool or network is a data change, not a code change).

## Ethereum Sepolia (chainId 11155111)

- V5 withdraw verifier: `0xb2fd0cfC04cb135194Af9a2EE0f955CD2d877DbD`
- Disclosure verifier: `0xd56e6125b2dF850D32F8c3538fF840528c53caf5`
- Token LTH: `0x53F7f947D150D41FecAC4e3FBE04cdD1bf19F67D` (18 decimals), faucet `0xF4ab260E65D7c6bEE3D1192d2Cef677199B1f214`
- PoseidonT3 copies deployed for this release: `0x026B99Fd627848a2071351301C63fFa330AFa686`

| Pool | Address | Deploy block |
|---|---|---|
| 100 LTH | `0x851981f6a35EB0D91d927c0e854774f5d0ce6233` | 11842583 |
| 50 LTH | `0x09d3D081195304FD83bb79e4b5B97344cE5e89b4` | 11842590 |
| 10 LTH | `0x4402b051482B0304A118A4F8A8bb10095127499D` | 11842595 |
| 1 LTH | `0x640A19F322d7D13779AcF8d64f64Efb3fF2cf876` | 11842601 |

## Arbitrum Sepolia (chainId 421614)

- V5 withdraw verifier: `0x2Cc27b22C0f83fCdb01791eD670D42Ca42d62bb9`
- Disclosure verifier: `0x247d68Bee78bD2B3082d9380A22cC70c443cbd00`
- Token LTH: `0x16b87f399a003E56eA6A680292b7278Df7D7b655` (18 decimals), faucet `0x53F7f947D150D41FecAC4e3FBE04cdD1bf19F67D`
- PoseidonT3 copies deployed for this release: `0x006da9E656581A7740856aA89c690b3Abd296c30`, `0x7d957dA586C00010e69e5Ed1192171F9a117626C`, `0x4EB857fEb8FC91F438122270aBbb16F6a5891720`

| Pool | Address | Deploy block |
|---|---|---|
| 100 LTH | `0x5E81DB3aE24B5B6d7E4d853933EF37b55d2ccDC7` | 315679153 |
| 50 LTH | `0xded64ec452C95bA69Fe80d51447cb8c4953E52C0` | 315679454 |
| 10 LTH | `0xe41964e7A9CBc9E2fE618a09a3692e8430c25cA5` | 315679601 |
| 1 LTH | `0x4480012096726C670A2C89E05AA37DF7258EF26a` | 315679833 |

## Robinhood Chain Testnet (chainId 46630)

- V5 withdraw verifier: `0xAb120F3da9D4b55ED5E816dcb2A1e2F191440174`
- Disclosure verifier: `0x28BEd69D013A04066f36EF90F995dc7811AFb672`
- Token LTH: `0x19DAD9E8595b5809a600c42273aC2a8360c15BA3` (18 decimals), faucet `0xB0DD35A89f62617b1B19FaCC4eb71D20A21fb719`
- Token USDG: `0x7E955252E15c84f5768B83c41a71F9eba181802F` (6 decimals), external faucet https://faucet.paxos.com/
- PoseidonT3 copies deployed for this release: `0xa9b9114F976057578133E06dB15cD0281A66bb07`, `0x797A96c6B52d3df596a0E8fcba6503756B4036bd`, `0x33bA81C2f2ef705910Ee7022d8e2481eD83aDD1B`

| Pool | Address | Deploy block |
|---|---|---|
| 100 LTH | `0x9d047AdA4e33D28fBd86220f3F899A7Df7e3360C` | 128804492 |
| 50 LTH | `0x288b8E0281b85118135F7bd55902f7167EAe5169` | 128804841 |
| 10 LTH | `0x362ceAD7a6bB1b99a69b6Eebc75e37a42d82F5F6` | 128805364 |
| 1 LTH | `0x24a394Fe56464A79A63Adbc57B785d599c3c0074` | 128806055 |
| 100 USDG | `0x6513862b2153c6AFd56C00B798a859548b0181e7` | 128806906 |
| 50 USDG | `0xF4ab260E65D7c6bEE3D1192d2Cef677199B1f214` | 128807418 |
| 10 USDG | `0xaA16653312E033623a6CD0D1f7DEFDFc21f30461` | 128808106 |
| 1 USDG | `0xc5C7Aa68BF65df8c7877809C21ceaa7E881ed1C4` | 128808711 |

## Legacy pools (V3/V4 generation): deprecated

These do **not** bind the recipient into the proof (see `docs/withdraw-recipient-binding.md`). Testnet tokens only; kept for history.

| Network | Address |
|---|---|
| Ethereum Sepolia | `0x8f64d930813936599f59De29eDb3B4aE38778f75` |
| Arbitrum Sepolia | `0x0fA26142342aA8609fa7AF180DdF91A815A3bE23` |
| Robinhood Chain Testnet | `0xDD991cC7E560681e964f693eF5C5eA7f424318A8` |
| Robinhood Chain Testnet | `0xb19557AEb6BA7e4a389474EC56ECbaBDc61B6aaC` |

## Addresses that mean different things on different networks

Contract addresses depend only on the deployer and its nonce, so the same address can exist on several networks with different contracts. Always pair an address with its chain.

- `0x53F7f947D150D41FecAC4e3FBE04cdD1bf19F67D`: LTH token on Ethereum Sepolia, LTH faucet on Arbitrum Sepolia
- `0xF4ab260E65D7c6bEE3D1192d2Cef677199B1f214`: LTH faucet on Ethereum Sepolia, V5 pool 50 USDG on Robinhood Chain
- `0x16b87f399a003E56eA6A680292b7278Df7D7b655`: LTH token on Arbitrum Sepolia, legacy verifier on Robinhood Chain
