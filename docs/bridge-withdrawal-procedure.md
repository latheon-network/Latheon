# Bridge withdrawal: Latheon test chain → Arbitrum Sepolia

**Status:** describes the bridge page (`bridge/index.html`) and the server script (`l2-eval-ci/testnet/chain/chain.mjs`, command `withdraw`) as they are in the repository on 29 October 2026. Testnet only, test LTH has no value. This is an internal write-up from reading the code and documents, **not an audit**. Line numbers refer to `bridge/index.html` unless another file is named.

Background: the Latheon test chain is an Arbitrum Orbit chain (Rollup mode, BoLD) that settles to Arbitrum Sepolia. Test LTH is an ERC-20 on Arbitrum Sepolia and the native (gas) coin on the chain. The chain's own bridge contracts move it; the page calls them from the user's wallet and no server of ours is involved (`docs/testnet.md`, *Bridge*).

## 1. The procedure, step by step

| # | Where | What happens | Code |
|---|---|---|---|
| 0 | page | The page loads `../demo/deployments.json`, takes the network that has a `bridge` entry (parent chain, inbox, rollup, bridge, token) and opens read providers for both chains. | `loadConfig()` 429–450 |
| 1 | Latheon chain | The user enters an amount and a destination (default: the connected address). The page refuses unless the chain balance is **strictly greater** than the amount (gas must remain), switches the wallet to the Latheon chain and calls `ArbSys.withdrawEth(destination)` at `0x…64` with `value = amount`. Gas limit: estimate on the public RPC + 30 %. | `withdraw()` 615–638; `withdrawEth` 629; `sendTx()` 414–418 |
| 2 | Latheon chain | The receipt is read back; the `L2ToL1Tx` event of ArbSys gives `caller`, `destination`, `position` (the withdrawal's leaf index in the chain's send Merkle tree), `arbBlockNum`, `ethBlockNum`, `timestamp`, `callvalue`, `data`. The record is stored **in the browser only** (`localStorage`, key `latheon-bridge-withdrawals`). | `readWithdrawal()` 560–571; storage 538–545 |
| 3 | (off-page) | The chain's batch poster posts the batch containing the withdrawal to the sequencer inbox on Arbitrum Sepolia. At low traffic it waits up to about an hour to fill a batch (`docs/testnet.md`, *How it is run*). | node configuration, not the page |
| 4 | (off-page) | The validator (our node, role staker, BoLD, strategy MakeNodes) posts an assertion covering that batch; it checks about every 15 minutes and reads only finalized Arbitrum Sepolia blocks. | `l2-eval-ci/testnet/README-RU.md`, *Валидатор* |
| 5 | (off-page) | After the confirm period (150 parent-chain blocks ≈ 30 min on this chain, set at creation: `chain.mjs` 133–139) the assertion is confirmed. Confirmation stores the new send root in the outbox, which emits `SendRootUpdated(outputRoot, l2BlockHash)`. | Arbitrum contracts |
| 6 | page | Status check, every 60 s and on demand: `Outbox.isSpent(position)` → "claimed"; otherwise the page finds the **newest** `SendRootUpdated` of the outbox (scanning Arbitrum Sepolia logs backwards in windows, at most 3,000,000 blocks back), reads the `sendCount` of the Latheon block it names, and shows "ready to claim" when `sendCount > position`, else "waiting". The outbox address is read from `rollup.outbox()`, not from the configuration. | `getOutbox()` 451–454; `latestConfirmedSendCount()` 574–595; `statusOf()` 597–602; `checkAll()` 604–612 |
| 7 | Latheon chain (read) | On "Claim", the page calls `NodeInterface.constructOutboxProof(size = confirmed sendCount, leaf = position)` at `0x…C8` on the Latheon RPC to get the Merkle proof. | `claim()` 640–662; 651 |
| 8 | Arbitrum Sepolia | The page switches the wallet to Arbitrum Sepolia and sends `Outbox.executeTransaction(proof, position, caller, destination, arbBlockNum, ethBlockNum, timestamp, value, data)`. The bridge then transfers `value` of the LTH ERC-20 to `destination`. The user pays this transaction in ETH. | 653–658 |
| 9 | page | The record is marked "claimed" with the Arbitrum Sepolia transaction hash. | 657–660 |

Recovery: a withdrawal can be re-added by its Latheon transaction hash (`lookup()` 663–673), so losing browser storage does not lose the withdrawal. Anyone may send step 8 for anyone: `executeTransaction` pays the destination named in the original withdrawal, not the sender.

The server script does the same with the Arbitrum SDK: `withdrawEth` (`chain.mjs` 315–320), then `ChildToParentMessage.status()` until confirmed and `execute()` (`chain.mjs` 328–356). Measured once on 24 October 2026: about two hours from step 1 to step 8 (`docs/testnet.md`).

Deposits (Arbitrum Sepolia → Latheon chain), for contrast: `approve(inbox, amount)` on the LTH token (only if the allowance is too small), then `ERC20Inbox.depositERC20(amount)` (`deposit()` 497–535; 511–513, 518). On a custom-gas-token chain this is a plain deposit message that credits the native coin to the same address once the node has read that parent block; it is not a retryable ticket. The page then polls the chain balance for up to 45 minutes (529).

## 2. What can go wrong

For each case: what the user sees, and what to do. "We" means the operator (today: Vladimir).

### 2.1 Deposit not credited (Arbitrum Sepolia → chain)

- **Cause:** the node is behind on reading the parent chain (parent RPC rate limits or outages: `status.sh` counts `429` and `error reading inbox`); the parent block is not yet finalized (the node waits for finality: 20–60 minutes for large deposits, `README-RU.md`, *Обслуживание*); or the depositor is a smart-contract wallet, whose deposit is credited to an **aliased** address (`docs/testnet.md`).
- **User sees:** "the deposit is taking longer than expected" after 45 minutes (`msg.depSlow`), while the Arbitrum Sepolia transaction succeeded.
- **What to do:** the funds are in the bridge contract on Arbitrum Sepolia and the message is in the delayed inbox; nothing is lost while the chain keeps running. Operator: `./status.sh`, `docker compose logs --tail 50 nitro`, check the parent RPC. If the sequencer never includes a delayed message, Arbitrum lets anyone force-include it after the maximum delay (`SequencerInbox.forceInclusion`); the page has no button for that. Smart-contract wallets: do not use them on this page.
- **Retryables:** the token bridge for *other* ERC-20s (`chain.mjs` `bridge`, 229–264) uses retryable tickets; a ticket that fails to auto-redeem must be redeemed by hand within its lifetime (seven days by default in Arbitrum) or it expires. The LTH deposit through `depositERC20` on the inbox does not use a retryable.

### 2.2 Withdrawal stuck at "waiting"

- **Cause A, no batch:** the batch poster has no ETH on Arbitrum Sepolia or cannot reach the parent RPC. Monitored: `monitor/check.sh` warns under 0.005 ETH (`monitor/targets.env`); `./chain-cmd.sh batches`.
- **Cause B, no assertion:** the validator has no ETH for gas, its node is stopped, or it fails to bond. `./chain-cmd.sh validator` shows its balance, whether the rollup allows it, and the latest confirmed assertion; the bot's `/status` shows the latest confirmed assertion too.
- **Cause C, the page reads the wrong outbox events:** the page uses only the newest `SendRootUpdated` within 3,000,000 Arbitrum Sepolia blocks (about 8–9 days at Arbitrum Sepolia's block rate). If no assertion has been confirmed in that window, the page shows "waiting" even for an old, confirmed withdrawal; it recovers as soon as any new assertion is confirmed.
- **User sees:** "waiting for confirmation" for more than about two hours.
- **What to do:** user: nothing is lost; the withdrawal stays claimable indefinitely once confirmed (Arbitrum outbox entries do not expire). Operator: fix the batch poster or validator (`./topup-cmd.sh batch-poster 0.1`, `./topup-cmd.sh validator 0.05`, `docker compose restart nitro`), then the chain catches up on its own.

### 2.3 Single validator, challenge period, disputed assertions

- **Fact:** one validator, run by us, is the only address allowed to post assertions (`chain.mjs` 141–142: `validators: [validator]`; `docs/testnet.md`, *Limits*). Its bond is 0.0001 ETH in WETH (`baseStake`, `chain.mjs` 134). Nobody else watches the chain's state on Arbitrum Sepolia.
- **Consequence:** a wrong assertion (bug, compromised validator key) would be confirmed after 30 minutes with nobody to challenge it. A confirmed wrong send root can release tokens from the bridge that were never withdrawn on the chain: **the bridge's LTH balance on Arbitrum Sepolia is only as safe as the validator key and the owner key.** Conversely, if our validator posts a wrong assertion and also catches it, a BoLD challenge delays every withdrawal by at least another challenge period.
- **Validator whitelist expiry:** Arbitrum rollups have a parameter (`validatorAfkBlocks`) after which, with no confirmed assertion, the validator whitelist is lifted and anyone with the base stake may post assertions. With a base stake of 0.0001 ETH and no other honest validator, a long validator outage would let a stranger assert and, unchallenged, confirm. Its value on this rollup has not been checked in this review (read `validatorAfkBlocks()` on the rollup to confirm).
- **User sees:** nothing unusual in the case of a wrong but unchallenged assertion; a longer "waiting" during a challenge.
- **What to do:** keep the validator funded and monitored; before any real value, run at least one independent validator (BoLD allows several) and raise the base stake. See `docs/operator-rights.md` and `docs/mainnet-readiness.md`.

### 2.4 The rollup owner changes the outbox or the bridge

- **Fact:** the rollup owner (today the deployer key, through the rollup's UpgradeExecutor) can set a new outbox, change the bridge's allowed outboxes and inboxes, upgrade every core contract through the ProxyAdmin, pause the rollup and, while paused, force-create and force-confirm assertions ([Arbitrum: ownership and access control](https://docs.arbitrum.io/launch-arbitrum-chain/operate/ownership-and-access)).
- **Page behaviour:** it always reads `rollup.outbox()` (451–454), so after a change it follows the new outbox. Withdrawals whose send root was stored only in the **old** outbox would then show "waiting" in the page and would have to be executed against the old outbox by hand, if the bridge still allows it.
- **User sees:** withdrawals that were "ready" go back to "waiting", or a claim reverts.
- **What to do:** announce any such change in advance; today there is no timelock, so users must trust that it will not be done silently. Before real value: owner behind a multisig with a timelock long enough for users to exit (`docs/operator-rights.md`).

### 2.5 Gas on the parent chain

- **Fact:** step 8 is paid in ETH on Arbitrum Sepolia by whoever sends it. The page estimates gas on the public RPC and adds 30 % (414–418). The deposit page refuses when the user has no ETH at all; the claim path does not pre-check the ETH balance.
- **User sees:** a wallet error ("insufficient funds") or a failed estimate on "Claim".
- **What to do:** get a little Sepolia ETH on Arbitrum Sepolia and press "Claim" again; the withdrawal is not lost and can be claimed later or by someone else for the same destination.

### 2.6 The sequencer does not publish batches or censors

- **Fact:** one sequencer, ours (`THREAT-MODEL.md` §8.4). If it stops posting, nothing new reaches Arbitrum Sepolia and no withdrawal can be confirmed (2.2). If it refuses a user's withdrawal transaction, the user can submit it through the delayed inbox on Arbitrum Sepolia and force-include it after the maximum delay; the page does not offer this.
- **What to do:** operator as in 2.2. For production: published force-inclusion instructions, and the parameters (maximum delay) stated in the documentation.

### 2.7 Custom gas token (LTH) specifics

- LTH is the gas coin on the chain and an ERC-20 on Arbitrum Sepolia; **the deployer key owns that ERC-20 and can mint it** (`contracts/LatheonToken.sol`: `mint` is `onlyOwner`). Bridged LTH therefore has no supply guarantee on either side.
- The batch poster is reimbursed in LTH through a constant fee-token pricer with a fixed test rate of 10,000 LTH per ETH (`chain.mjs` 56–58, 113–121). If the real cost of posting changes, the rate does not follow; on a production chain a fixed rate is a subsidy or a loss for the operator.
- On a custom-gas-token chain the bridge holds the ERC-20 and every withdrawal is paid in it. Fee-on-transfer, rebasing or pausable tokens are not supported as gas tokens; test LTH is a plain OpenZeppelin ERC-20, so this does not apply today, but it constrains the choice of a production gas token.
- Smart-contract wallets: deposits are credited to an aliased address (2.1).

### 2.8 The page itself

- Withdrawal records live only in the browser; another device or cleared storage shows an empty list. Recovery: "find by transaction hash" (`lookup()`).
- The page reads the public RPCs of both chains; rate limits (429) are retried three times (411) and then shown as an error.
- **Bridging is public:** it links the Arbitrum Sepolia address to the same address on the chain. Private funding of the chain is unsolved (`docs/bridge-privacy-design.md`).

## 3. Summary of trust today

A withdrawal from the chain to Arbitrum Sepolia depends on: our batch poster (liveness), our single validator (liveness and correctness, unchallenged), and the deployer key (which can change the outbox, upgrade the contracts and mint LTH). None of these is protected by a multisig or a timelock today. Acceptable for a testnet with valueless tokens only.
