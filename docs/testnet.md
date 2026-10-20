# Latheon test chain

Latheon's own test chain: an Arbitrum Orbit chain that settles to Arbitrum Sepolia, with **test LTH as its gas coin**. The V5 pools and the distribution router run on it in their native-coin form: you deposit LTH itself, with no approval step, and a withdrawal to an empty address leaves that address with LTH it can pay gas with.

**Testnet only. No audit. Test LTH has no value.** Read [Limits](#limits) before relying on anything here.

## Connect

| | |
|---|---|
| Network name | Latheon Testnet |
| Chain ID | 60531373273 (`0xe17f374d9`) |
| RPC | https://rpc.testnet.latheon.xyz |
| Currency | LTH (test), 18 decimals |
| Block explorer | https://explorer.testnet.latheon.xyz |
| Faucet | https://explorer.testnet.latheon.xyz/faucet |
| Demo | https://latheon.xyz/demo (network "Latheon Testnet", listed first) |
| Settles to | Arbitrum Sepolia (421614), Rollup mode |

The demo adds the network to your wallet when you connect. To add it by hand, use the values above.

**Getting test LTH:** the faucet gives 100 LTH per address once a day (also once a day per IP, at most 5,000 LTH a day in total, and not to an address that already holds 100 LTH or more). That covers many deposits and withdrawals: on this chain a transaction costs a small fraction of one LTH.

## Try it

1. Open the faucet, paste your address, receive 100 LTH.
2. Open the demo, pick **Latheon Testnet**, connect your wallet.
3. Deposit into a fixed pool (100 / 50 / 10 / 1 LTH), or any whole amount through the router; save the note or the master key.
4. Withdraw to a fresh, empty address. It receives the LTH and can use it for gas right away.
5. Optional: create a disclosure proof for an auditor and check it in the auditor tab.

## Contracts

Built from Latheon commit `180b4b8` (solc 0.8.37, optimizer 200 runs, EVM version paris). Machine-readable: [`sdk/deployments.json`](../sdk/deployments.json).

| Contract | Address |
|---|---|
| Pool 100 LTH (`LatheonShieldedPoolV5Native`) | `0xf10AF1771450c528fee0c5435D3E4f4214073aFe` |
| Pool 50 LTH | `0x4D9b9624418e2E91a38122D53e2A12eE028194b3` |
| Pool 10 LTH | `0xc27DfC8A1CfD74D0D5645198Fb0d8B6b50292618` |
| Pool 1 LTH | `0xD01D19B9D296299619f681b842b3b61C79736F3a` |
| Router (`LatheonDistributionPoolNative`) | `0x0C3475657D4Bd198efe068dDB064725B6514FB04` |
| Withdrawal verifier (`withdraw_v3`) | `0x67451b65BD9F0d1486A736927f8ef29d6BE72062` |
| Disclosure verifier | `0xB86360CBDE78664bb1674c367391E9d79c37F294` |
| PoseidonT3 library | `0x8caC8633D6399cDe24d58e1c42cfc55ab00830CF` |

Chain contracts on Arbitrum Sepolia: rollup `0xdDcA9a000d2DE69D6C11050B9e8fe90B5e02Bd89`, inbox `0x3F306353543EB48F419C8F8a19BfAd9fcB86aB17`, bridge `0x4D1FdE71BAd635148727694FEa04f24CAf881990`, sequencer inbox `0x3b7f5F7fF9b38DFb848d9a4724dD45da7647Bea2`, test LTH token `0xcB44A83A9AD6dE27af7936A4fEbBEDb25c58db02`.

## Measured gas

Measured on this chain on 20 October 2026 with real proofs. "Total" includes the charge for publishing the transaction's data to Arbitrum Sepolia, which is most of it; "execution" is the EVM work alone.

| Operation | Execution | Total |
|---|---|---|
| Router deposit, 11 LTH as 2 notes | 815,774 | 10,121,111 |
| `withdrawMany`, 2 notes to an empty address | 554,474 | 30,273,597 |

At the chain's minimum price of 0.1 gwei these cost about 0.001 and 0.003 LTH. Fees are set by the chain's own minimum price; data cost on the parent chain is paid by the chain in ETH whatever that price is.

## How it is run

- One rented server runs the node (Arbitrum Nitro), the explorer (Blockscout), the faucet and an HTTPS proxy. Setup, scripts and the CI rehearsals: [latheon-network/l2-eval-ci](https://github.com/latheon-network/l2-eval-ci), folder `testnet/`.
- The node is the only sequencer and the only validator. Its assertions on Arbitrum Sepolia are confirmed after the challenge period (30 minutes), so a withdrawal from the chain to Arbitrum Sepolia becomes executable about an hour after it is sent.
- Public RPC and explorer API are rate-limited per IP (RPC 25 requests a second and 600 a minute; explorer API 40 a second); above that the answer is HTTP 429 with Retry-After. The node's debug methods are not exposed.
- The endpoints are checked from outside every 15 minutes.

## Limits

- **Trust:** one sequencer and one validator, both run by us; nobody else can challenge the chain's assertions yet. The chain owner, the rollup owner (upgrades) and the owner of the test LTH token are one development key today. A multisig with a timelock is planned before any production chain (see `ROADMAP.md`).
- **Privacy:** the pools on this chain are new, so the anonymity set is tiny. Your deposit address is public; privacy here means a withdrawal cannot be linked to its deposit, and only once enough other deposits exist. There is no relayer yet: the wallet you connect pays the gas for a withdrawal and is visible, so use a different wallet than the one you deposited from (the demo warns about this).
- **Availability:** a single server; it can be down or reset. Test LTH and test notes may be lost if the chain has to be recreated.
- **No audit, development keys:** the circuits use keys from a single-party setup (`docs/dev-ceremony-v3.md`); see `THREAT-MODEL.md` for what is and is not protected.

## Report a problem

Open an issue on GitHub or write to latheon.protocol@gmail.com. Security issues: see `SECURITY.md`.
