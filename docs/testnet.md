# Latheon test chain

Latheon's own test chain: an Arbitrum Orbit chain that settles to Arbitrum Sepolia, with **test LTH as its gas coin**. The pools and the distribution router run on it in their native-coin form: you deposit LTH itself, with no approval step, and a withdrawal to an empty address leaves that address with LTH it can pay gas with.

**Current generation: V7** (circuit `withdraw_v5`): four pools of 100 / 50 / 10 / 1 LTH and the V7 router, deployed 27 October 2026. Their addresses are in the [V7 table](#current-contracts-v7) below and, machine-readable, in [`sdk/deployments.json`](../sdk/deployments.json) (entries with version `v7-native` / `v7`). **Deposit only into V7.**

**The older V5 and V6 sets on this chain are deprecated and forgeable.** Every circuit before V7 let a crafted proof withdraw without a deposit (STATUS §7, THREAT-MODEL §8.0). Our demo no longer deposits into them, but their contracts have no pause and still accept deposits from any other client, so a deposit made there can be taken by anyone. They stay listed only so notes already in them can be withdrawn; `deployments.json` marks them `"frozen": true, "forgeable": true`. If you hold such a note, withdraw it; never make a new deposit there.

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
| Demo | https://latheon.xyz/demo (network "Latheon Testnet", listed first; the V7 pools are the default, V5/V6 are shown as frozen) |
| Bridge | https://latheon.xyz/bridge (test LTH between Arbitrum Sepolia and this chain) |
| Settles to | Arbitrum Sepolia (421614), Rollup mode |

The demo adds the network to your wallet when you connect. To add it by hand, use the values above.

**Getting test LTH:** the faucet gives 100 LTH per address once a day (also once a day per IP, at most 50,000 LTH a day in total (raised from 5,000 on 26 October 2026), and not to an address that already holds 100 LTH or more). That covers many deposits and withdrawals: on this chain a transaction costs a small fraction of one LTH.

## Try it

1. Open the faucet, paste your address, receive 100 LTH.
2. Open the demo, pick **Latheon Testnet**, connect your wallet.
3. Deposit into a V7 fixed pool (100 / 50 / 10 / 1 LTH), or any whole amount through the V7 router; save the note or the master key. The demo offers deposits only into V7; the V5/V6 entries marked "frozen" are there for withdrawals of old notes.
4. Withdraw to a fresh, empty address, through the relayer (the default; no wallet needed). It receives the LTH and can use it for gas right away.
5. Optional: create a disclosure proof for an auditor and check it in the auditor tab.

## Bridge

The page https://latheon.xyz/bridge moves test LTH between Arbitrum Sepolia, where it is the ERC-20 token below, and this chain, where it is the gas coin. It calls the chain's own bridge contracts from your wallet; no server of ours is involved.

- **Deposit** (Arbitrum Sepolia → this chain): `approve` for exactly the amount, then `depositERC20` on the inbox. The LTH arrives at the same address here once the chain has read that Arbitrum Sepolia block; when we moved 50,000,000 LTH this way it took a few minutes, and the 10 and 100 LTH deposits made through the page on 24 October arrived in under a minute. Use an ordinary wallet: a smart-contract wallet's deposit is credited to an aliased address.
- **Withdrawal** (this chain → Arbitrum Sepolia): `ArbSys.withdrawEth` here, then, once the validator's assertion that includes it is confirmed on Arbitrum Sepolia (about two hours at today's low traffic, see *How it is run*), `Outbox.executeTransaction` there releases the token. The page lists your withdrawals, shows when one can be claimed and sends the claim; a withdrawal can also be found by its transaction hash. Both steps need gas: LTH here, a little ETH on Arbitrum Sepolia for the claim.
- **Bridging is public.** It links your Arbitrum Sepolia address to the same address here. Privacy comes from the pools (deposit, then withdraw to a new address), not from the bridge; private funding of the chain is an open question (`docs/bridge-privacy-design.md`).

Machine-readable: the `bridge` entry of this network in [`sdk/deployments.json`](../sdk/deployments.json).

## Contracts

Machine-readable, and the source of truth for addresses: [`sdk/deployments.json`](../sdk/deployments.json) (the same file as `demo/deployments.json`). If this page and that file ever differ, the file is right.

### Current contracts (V7)

**Deposit here.** Deployed 27 October 2026 from Latheon commit `129a4c0`; the current generation, listed first and used by default in the demo and in the load test. Circuit `withdraw_v5`: like `withdraw_v4` (20-level trees, the recipient, the relayer and the relayer's fee bound into the proof), plus the Merkle path selector constrained to a bit, which closes the flaw of every earlier circuit (a non-binary path let anyone withdraw without a deposit; see STATUS §7 and THREAT-MODEL §8.0). The note format is unchanged. A pool holds up to 1,048,576 deposits and keeps its last 100 roots.

| Contract | Address |
|---|---|
| Pool 100 LTH (`LatheonShieldedPoolV7Native`) | `0x53a11072B55761Bc5e17C5B4c150a0443A7dA6ae` |
| Pool 50 LTH | `0x5A3DA32BCc848a81A3a379620120ae06DfA7C657` |
| Pool 10 LTH | `0xAe33ac9C4D5Ff55D571a0a2Ae4E6e96Db006A429` |
| Pool 1 LTH | `0x358A6567F8Fd54D1d70482616dd24d0FeDD2678A` |
| Router (`LatheonDistributionPoolV7Native`) | `0x1D1189D5399B24BB40858AEACDb649977b596Cf2` |
| Withdrawal verifier (`withdraw_v5`) | `0xD63EFf571f9c89C31E8cAe966f3f2cEd105d6b51` |

The disclosure verifier (`0xB86360CBDE78664bb1674c367391E9d79c37F294`) and the PoseidonT3 library (`0x8caC8633D6399cDe24d58e1c42cfc55ab00830CF`) are shared with the older sets. The V7 pools hold 999 LTH from a gas measurement made with unspendable commitments (23 deposits that are not real notes).

### Deprecated: V6 and V5 sets (withdrawal of existing notes only)

> **Do not deposit into these contracts.** They are built on circuits with the pre-V7 flaw, so a deposit in them can be withdrawn by anyone with a forged proof. The demo no longer offers deposits into them, but the contracts themselves have no pause and accept deposits from any other client or script. `deployments.json` marks every one of them `"frozen": true` (pools also `"forgeable": true`). They stay deployed and listed only so notes already deposited there can be withdrawn (in the demo or through the relayer).

**V6 set** (deployed 26 October 2026 from Latheon commit `5db02c6`; superseded by V7 on 27 October). 20-level trees (1,048,576 deposits per pool, last 100 roots kept); circuit `withdraw_v4`, which binds the recipient, the relayer and the relayer's fee into the proof but has the pre-V7 flaw. The V6 pools hold 999 LTH from a gas measurement made with commitments that have no known secret (23 deposits that are not real notes; like everything in these pools, they are exposed to the pre-V7 flaw).

| Contract | Address |
|---|---|
| Pool 100 LTH (`LatheonShieldedPoolV6Native`) | `0xB4035F257793bB7323f9373Af41e5298b04A80dF` |
| Pool 50 LTH | `0xd3915aE31f08549cC957EF6bD9ea9104F24aD60C` |
| Pool 10 LTH | `0x002B880740926A37da5b6f56faDbFD79400c759d` |
| Pool 1 LTH | `0x3c1E793714E0af7d9BC30508fEeD3E062Ea5b260` |
| Router (`LatheonDistributionPoolV6Native`) | `0x93963CF193DD6a961eFEA8311b0834EE31518150` |
| Withdrawal verifier (`withdraw_v4`) | `0x49694EF1977b4A201b378740557f2aa41BDC3857` |

**V5 set** (the chain's first set, in use from the chain's opening on 20 October 2026; built from Latheon commit `180b4b8`, solc 0.8.37, optimizer 200 runs, EVM version paris). 8-level trees (256 deposits per pool, last 30 roots kept); circuit `withdraw_v3` (recipient bound, no relayer fee), with the pre-V7 flaw. The disclosure verifier and the PoseidonT3 library deployed with it are still used by V6 and V7.

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

Chain contracts on Arbitrum Sepolia: rollup `0xdDcA9a000d2DE69D6C11050B9e8fe90B5e02Bd89`, inbox `0x3F306353543EB48F419C8F8a19BfAd9fcB86aB17`, bridge `0x4D1FdE71BAd635148727694FEa04f24CAf881990`, outbox `0x61615B1b8493df67846C6BF17ab2EC4Fcb1775f7`, sequencer inbox `0x3b7f5F7fF9b38DFb848d9a4724dD45da7647Bea2`, test LTH token `0xcB44A83A9AD6dE27af7936A4fEbBEDb25c58db02`.

## Measured gas

Measured on this chain with real proofs (V5 on 20 October 2026, V6 on 26 October, V7 on 27 October). "Total" includes the charge for publishing the transaction's data to Arbitrum Sepolia, which is most of it; "execution" is the EVM work alone.

| Operation | Execution | Total |
|---|---|---|
| V5 router deposit, 11 LTH as 2 notes | 815,774 | 10,121,111 |
| V5 `withdrawMany`, 2 notes to an empty address | 554,474 | 30,273,597 |
| V6 router deposit, 11 LTH as 2 notes (26 October) | 1,749,602 | 12,538,839 |
| V6 `withdrawMany`, 2 notes with a relayer fee in the proofs | 625,860 | 37,174,867 |
| V6 router deposit, 999 LTH as 23 notes | 16,229,508 | 52,218,520 |
| V7 router deposit, 11 LTH as 2 notes (27 October) | 1,749,602 | 12,219,550 |
| V7 `withdrawMany`, 2 notes with a relayer fee in the proofs | 625,896 | 35,912,159 |
| V7 router deposit, 999 LTH as 23 notes | 16,229,568 | 51,153,549 |
| V7 router deposit from the demo, 111 LTH as 3 notes | — | 15,045,664 |
| V7 `withdrawMany` of 3 notes through the relayer (demo) | — | 48,694,924 |

At the chain's minimum price of 0.1 gwei these cost about 0.001 to 0.005 LTH. A V6 or V7 deposit costs about twice the execution gas of V5 per note because its tree is 20 levels deep instead of 8. The V5 and V6 rows are kept as a record; those pools are deprecated. Fees are set by the chain's own minimum price; data cost on the parent chain is paid by the chain in ETH whatever that price is.

## How it is run

- One rented server runs the node (Arbitrum Nitro), the explorer (Blockscout), the faucet and an HTTPS proxy. Setup, scripts and the CI rehearsals: [latheon-network/l2-eval-ci](https://github.com/latheon-network/l2-eval-ci), folder `testnet/`.
- The node is the only sequencer and the only validator. Its assertions on Arbitrum Sepolia are confirmed after the challenge period (30 minutes), so a withdrawal from the chain to Arbitrum Sepolia becomes executable after three waits in a row: the batch poster posts the batch that contains it (at low traffic it waits up to about an hour to fill a batch), the validator posts an assertion covering that batch (it checks every 15 minutes), and the assertion is confirmed after the challenge period. Measured on 24 October 2026: a withdrawal sent at 13:33 UTC was in a batch at 14:20, in an assertion at 14:43, confirmable at about 15:29, and claimed at 15:38, about two hours in total.
- Public RPC and explorer API are rate-limited per IP (RPC 25 requests a second and 600 a minute; explorer API 40 a second); above that the answer is HTTP 429 with Retry-After. The node's debug methods are not exposed.
- The endpoints are checked from outside every 15 minutes.
- **Withdrawal relayer:** `https://explorer.testnet.latheon.xyz/relay/api` (`GET /status`, `POST /withdraw`, `POST /withdrawMany`). It sends withdrawals from its own address and pays the gas, so a fresh address can receive without holding anything and no wallet is needed to withdraw. It accepts only the pools and routers listed above (V7, and the deprecated V5 and V6 sets so their notes stay withdrawable; for V6 and V7 the proof may name a relayer and a fee, and this relayer accepts only no fee or a fee paid to itself; it only sends withdrawals, never deposits), simulates every request first and refuses what the chain would reject without spending gas, allows 30 relayed withdrawals per IP per hour and 5,000 a day in total (raised from 10 and 500 on 26 October 2026), and charges no fee. It cannot redirect a withdrawal: the proof is bound to the recipient. If it refuses or is down, the same proof can be sent from any wallet.

## Limits

- **Trust:** one sequencer and one validator, both run by us; nobody else can challenge the chain's assertions yet. The chain owner, the rollup owner (upgrades) and the owner of the test LTH token are one development key today. A multisig with a timelock is planned before any production chain (see `ROADMAP.md`).
- **Privacy:** the pools on this chain are new, so the anonymity set is tiny. Your deposit address is public; privacy here means a withdrawal cannot be linked to its deposit, and only once enough other deposits exist. By default the demo sends withdrawals through the chain's relayer (below), so your wallet does not appear in them; if you untick it, the wallet you connect sends and pays for the withdrawal in public, so use a different wallet than the one you deposited from (the demo warns about this). The relayer, like any server you talk to, sees the recipient and your IP address.
- **Capacity:** a V7 pool (like a V6 pool) takes 1,048,576 deposits and keeps its last 100 roots; a deprecated V5 pool takes at most 256 and keeps 30. A proof names one root: if that many deposits land in the pool between making the proof and sending it, the pool refuses it ("Unknown root") and nothing is spent; the demo then makes a new proof on its own. The router takes at most 32 notes per deposit and 16 per `withdrawMany`.
- **Availability:** a single server; it can be down or reset. Test LTH and test notes may be lost if the chain has to be recreated.
- **Older pools are forgeable:** the V5 and V6 pools on this chain (and every pool before V7 on other networks) carry the circuit flaw described above; their contracts still accept deposits. Deposit only into V7.
- **No audit, development keys:** the circuits use keys from a single-party setup (V7: `docs/dev-ceremony-v5.md`; earlier: `docs/dev-ceremony-v4.md`, `docs/dev-ceremony-v3.md`); see `THREAT-MODEL.md` for what is and is not protected. V7 itself has had no independent review.

## Report a problem

Open an issue on GitHub or write to latheon.protocol@gmail.com. Security issues: see `SECURITY.md`.
