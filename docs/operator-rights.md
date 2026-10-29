# Operator rights on the Latheon test chain

**Status:** an internal inventory made from the repository on 29 October 2026 (`l2-eval-ci/testnet`: `chain/chain.mjs`, `docker-compose.yml`, `ops-runner.sh`, `faucet/`, `relayer/`, `bot/`; this repository: `docs/testnet.md`, `THREAT-MODEL.md` §8.4) and the Arbitrum documentation linked below. **Not an audit**, and not read from the live chain: the on-chain roles were set at creation by `chain.mjs` and have not been re-checked against the deployed contracts in this review. Testnet only.

The Latheon contracts themselves (V7 pools, router, verifiers) have **no owner, no pause and no upgrade path**: no key in the table below can move a note or change a pool's rules. What the keys control is the chain the pools run on, the bridge to Arbitrum Sepolia, the test LTH token, and the services around them.

## 1. Who holds what today

| Role | Key / account | Where it lives | Set by |
|---|---|---|---|
| Rollup owner (parent-chain UpgradeExecutor `EXECUTOR_ROLE`, which owns the ProxyAdmin of the core contracts and is the rollup admin) | deployer key | Vladimir only; typed in hidden at each command, not stored on the server | `chain.mjs` 133–134 (`owner: deployer.address`) |
| Chain owner on the chain (`ArbOwner` precompile) | deployer key, **as a plain EOA** (`InitialChainOwner`) | same | `chain.mjs` 132 |
| Token bridge owner (other ERC-20s) | deployer key (`rollupOwner`) | same | `chain.mjs` 235–239 |
| Test LTH ERC-20 owner on Arbitrum Sepolia (`mint`) | deployer key | same | `chain.mjs` 104–107, `contracts/LatheonToken.sol` |
| Sequencer | the Nitro node | server, container `nitro` | node configuration |
| Batch poster (allowed in `SequencerInbox`) | batch-poster key | server, `chain/secret/` (also inside `node-config.json`) | `chain.mjs` 124–127, 141–142 |
| Validator (the only whitelisted one, BoLD, bond 0.0001 ETH) | validator key | server, `chain/secret/` | `chain.mjs` 124–127, 134, 141–142 |
| Relayer (pays gas for withdrawals) | relayer key | server, `relayer/secret/relayer.key` | `relayer-cmd.sh init` |
| Faucet | faucet key | server, `faucet/secret/faucet.key` | `faucet-cmd.sh init` |
| Faucet refills from the bot ("ops wallet") | ops key | server, `faucet/secret/ops.key` | `faucet-cmd.sh ops-init` |
| Telegram bot | bot token (no chain key) | server `.env`, GitHub secrets | `README-RU.md`, *Бот* |
| `ops-runner.sh` (runs the bot's requests) | root on the server, via systemd | server | `ops-install.sh` |
| Load-test wallets | load-test master key | server, `loadtest/secret/` | `loadtest-cmd.sh` |
| Server | SSH key (and Hetzner console) | Vladimir's laptop; SSH only through WireGuard after `wg-lockdown.sh` | `README-RU.md`, *VPN* |
| Website and demo (latheon.xyz) | Netlify account | Vladimir | uploaded by hand |
| Repositories, CI, monitor alerts | GitHub organisation `latheon-network` | Vladimir | — |

## 2. What each can do, what users see, how to limit it

| Who | Can do | What a user sees | How to limit (before any real value) |
|---|---|---|---|
| **Rollup owner** (deployer key) | Upgrade every core contract on Arbitrum Sepolia (Rollup, Bridge, Inbox, Outbox, SequencerInbox) through the ProxyAdmin; set the outbox, inboxes, validators, batch posters, confirm period, base stake, WASM module root (i.e. the chain's state-transition function); pause the rollup and, while paused, force-create and force-confirm assertions ([Arbitrum: ownership and access control](https://docs.arbitrum.io/launch-arbitrum-chain/operate/ownership-and-access)). **In effect: can release every token held by the bridge.** | Nothing until it happens: changes are ordinary transactions on Arbitrum Sepolia, visible on Arbiscan but not announced. Withdrawals may stop being claimable (see `docs/bridge-withdrawal-procedure.md` §2.4). | Owner = a Safe multisig (keys on separate devices and people), every action through a timelock longer than the withdrawal delay so users can exit first; a separate, small emergency role that can only pause. Publish the owner and timelock addresses; monitor `ProxyAdmin` and rollup admin events. |
| **Chain owner** (deployer key, EOA on the chain) | Through `ArbOwner`: set gas prices and limits, L1-pricing parameters, which address receives fees, add and remove chain owners, schedule ArbOS upgrades, change chain configuration ([precompiles reference](https://docs.arbitrum.io/build-decentralized-apps/precompiles/reference)). Cannot spend user balances directly; combined with the rollup owner's control of the WASM module root it can change the chain's rules. | Fee changes; transactions failing after a parameter change. | Transfer chain ownership from the EOA to the chain-side UpgradeExecutor, itself controlled by the same multisig + timelock as the rollup ([Orbit chain ownership](https://docs.arbitrum.io/launch-orbit-chain/concepts/chain-ownership)). Today the deployer EOA calls `ArbOwner` directly. |
| **Token owner** (deployer key) | Mint any amount of test LTH on Arbitrum Sepolia, which can then be bridged in as the chain's gas coin. | Nothing; supply grows. | For a production gas token: fixed supply or mint behind the multisig + timelock, with published supply. |
| **Sequencer** (node) | Order transactions, delay or refuse them, see them before they are ordered (front-running is possible, see `THREAT-MODEL.md` §8.5 for the batch-cancel case). Cannot forge a proof or redirect a withdrawal (recipient, relayer and fee are bound to the proof). | Delayed or missing transactions. | Documented force-inclusion through the delayed inbox (maximum delay stated publicly); later a decentralised or shared sequencer (an open, industry-wide problem). |
| **Batch poster** | Post (or stop posting) batches. Cannot post a different chain history than the sequencer produced without the node's cooperation; can stop withdrawals from becoming claimable by not posting. | Withdrawals stuck at "waiting". | Separate key with limited ETH (today 0.02 ETH funding); monitoring of its balance (exists: `monitor/check.sh`) and of time since the last batch (not monitored today). |
| **Validator** (only one, ours) | Post assertions about the chain's state. With nobody else validating, a wrong assertion (bug or stolen key) is confirmed after 30 minutes and could release bridge funds. | Nothing until funds are gone. | At least one independent validator (BoLD supports several), higher base stake, alerting on any assertion not posted by us and on time since the last confirmation; check the `validatorAfkBlocks` setting (after that long without confirmation the whitelist is lifted). |
| **Relayer key** | Send or not send withdrawals it receives. Cannot redirect them or take more than the fee in the proof (today 0). Spends its own LTH on gas. | A refused or slow relay; the same proof can be sent from any wallet. | Keep a small balance (monitored: `MIN_RELAYER_LTH`); limits already in place (per IP, daily cap, queue, only code-less recipients). |
| **Faucet key** | Pay out its own balance. | Faucet empty or paused. | Small balance; limits already in place (per address, per IP, daily cap). |
| **Ops wallet** | Refill the faucet (at most `OPS_FUND_MAX`, default 50,000 LTH, per request from the bot). | — | Keep a limited balance (as documented). |
| **Telegram bot / ops-runner** | Restart services, read logs, pause/resume and refill the faucet, nothing else (fixed list in `ops-runner.sh`). The bot has no key and no Docker access; `ops-runner.sh` runs as root. | Restarts (short outages). | The list of actions is already narrow. The runner should run with the least privilege it needs and treat everything in the queue folder (written by the bot's container) as untrusted input. |
| **Server root / SSH** | Everything above except the deployer key: all service keys, the node's data, the explorer, logs (which contain users' IP addresses). | Anything. | WireGuard-only SSH (exists), separate servers or at least separate users per service, keys in a secrets manager or HSM, backups, an independent second node. |
| **Netlify / GitHub** | Change the website, demo and bridge page (e.g. point the demo at different contracts); change the scripts the server pulls. | A different site. | Two-factor login, protected `main` branch, signed releases; the demo pins and checks circuit files by SHA-256 already (`STATUS.md`). |

## 3. The staged plan already in ROADMAP.md

`ROADMAP.md` (VISION, *Control of the chain, in stages*) states the intended order: a multisig with a timelock over every upgrade and chain-owner power at launch; then a security council with a majority of outside members; later ordinary upgrades by LTH holders through a timelock, with the council keeping emergency powers. None of these stages exists today. The table above lists what each stage must cover; `docs/mainnet-readiness.md` tracks it as a condition before any real value.

## 4. How to check the live roles (read-only, no key)

These reads are not part of this review (no network access was used). With any Arbitrum Sepolia RPC and the addresses in `sdk/deployments.json` (`bridge` entry) and `l2-eval-ci/testnet/chain/out/chain.json`:

- rollup: `owner()`, `isValidator(validator)`, `confirmPeriodBlocks()`, `baseStake()`, `validatorAfkBlocks()`, `outbox()`, `wasmModuleRoot()`;
- the ProxyAdmin's `owner()` and the UpgradeExecutor's role members;
- `SequencerInbox.isBatchPoster(batchPoster)` and `maxTimeVariation()`;
- on the chain: `ArbOwnerPublic.getAllChainOwners()` at `0x…6b`, `ArbOwnerPublic.getNetworkFeeAccount()`.

`./status.sh` and `./chain-cmd.sh validator` on the server already show part of this.
