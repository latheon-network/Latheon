# Incident response on the Latheon test chain

**Scope:** what to do when something goes wrong on the Latheon test chain, its bridge, relayer, faucet or the website. Written on 29 October 2026 from the scripts in [`latheon-network/l2-eval-ci`](https://github.com/latheon-network/l2-eval-ci), folder `testnet/`. Testnet only, test LTH has no value; this procedure has **not been rehearsed yet** and is not an audit. No command here needs or prints a private key unless it says so.

Server commands run on the server in the folder `~/l2-eval-ci/testnet` (the clone made by `README-RU.md`). SSH goes through WireGuard once `vpn/wg-lockdown.sh` is active (`README-RU.md`, *VPN*):

```powershell
ssh -i C:\Users\smirn\.ssh\latheon_server root@10.66.0.1
```

```bash
cd ~/l2-eval-ci/testnet
```

If the tunnel is down, use the Hetzner web console.

## 0. Severity

| Level | Examples | First response |
|---|---|---|
| **S1: funds at risk** | a flaw that lets someone withdraw without a deposit or twice; a bridge release without a withdrawal; a leaked deployer, validator or relayer key | within the hour: contain (§2), then communicate (§3) |
| **S2: service down or wrong** | chain stalled, batches or assertions not posted, relayer refusing valid withdrawals, explorer down | same day: diagnose (§1), fix (§4) |
| **S3: degraded** | faucet empty, rate limits hit, slow explorer | next working session |

Pools before V7 are already known to be forgeable (`THREAT-MODEL.md` §8.0); a drain of a frozen pool is expected and is S2 at most, but it must still be recorded.

## 1. Detect and diagnose

Where alerts come from:

- **Outside monitor** (GitHub Actions `testnet monitor`, every 15 minutes; `monitor/check.sh`, thresholds in `monitor/targets.env`): RPC, explorer API and pages, faucet page and balance, relayer status and balance, ETH of the batch poster and validator. Alerts go to Telegram. A manual run with the summary box ticked sends the current summary. Scheduled runs can be delayed by GitHub.
- **Telegram bot** `/status` and the dashboard `https://explorer.testnet.latheon.xyz/ops/`: chain block, batches and latest confirmed assertion on Arbitrum Sepolia, balances, faucet, pools, warnings.
- **Users:** GitHub issues, e-mail (latheon.protocol@gmail.com), messages.

**Not monitored today** (check by hand during an incident): time since the last batch and last confirmed assertion; the pool invariant (each pool's balance = denomination × (deposits − withdrawals)); owner or admin calls on the rollup, ProxyAdmin or token.

On the server, read-only:

```bash
./status.sh                         # containers, node errors in the last hour, disk, blocks, batches, validator, balances, warnings
./status.sh 24                      # the same with a day of node log
docker compose ps
docker compose logs --tail 100 nitro
docker compose logs --tail 100 relayer
docker compose logs --tail 100 faucet
./chain-cmd.sh batches              # do batches reach Arbitrum Sepolia? (asks for the deployer key: skip it unless needed)
cat ops-queue/actions.log           # what the bot has done
```

`./chain-cmd.sh validator` (asks for the deployer key) shows the validator's balance, whether the rollup allows it and the latest confirmed assertion.

Write down from the start, in a **private** note (never in the repository): time of detection, what was seen, transaction hashes, every action taken and when.

## 2. Contain

Pick the smallest step that stops the harm. Every step below can be undone.

### 2.1 Freeze the interfaces (website, demo, bridge page)

The demo and the bridge page read `demo/deployments.json` from latheon.xyz. Netlify is updated **only by Vladimir**, by hand, from an archive that is previewed first.

- **Stop deposits into a pool or router in the demo:** in `demo/deployments.json` (and `sdk/deployments.json`), set `"frozen": true` on the affected entries (and `"forgeable": true` if the flaw allows forgery). The demo then refuses deposits and shows the frozen banner (`demo/index.html`, `p.frozen`); withdrawals of existing notes stay possible. Build the site archive, check the preview, upload.
- **Take the bridge page offline:** remove the `bridge` entry of the network from `demo/deployments.json`; the page then shows a configuration error and sends nothing. This only stops our page: the bridge contracts on Arbitrum Sepolia stay usable from any other client.
- **Banner on the explorer:** edit `NEXT_PUBLIC_MAINTENANCE_ALERT_MESSAGE` in `docker-compose.yml` (service `frontend`), then:

  ```bash
  docker compose up -d frontend
  ```

**Limits, to say plainly to users:** the pools and router have no pause. Freezing the interface does not stop anyone who calls the contracts directly.

### 2.2 Stop services

```bash
docker compose stop relayer         # relayed withdrawals stop; users can still withdraw from their own wallet
docker compose stop faucet          # the faucet page stops answering
./loadtest-cmd.sh stop              # if a load test is running (the step in progress finishes first)
```

The faucet can also be paused from the bot (`/menu` → faucet → pause, confirm with «Да»); while a service container may be compromised, prefer `docker compose stop faucet`, which does not touch files the service can write. Start again with `docker compose up -d relayer faucet`.

### 2.3 Stop the chain (last resort)

```bash
docker compose stop nitro           # sequencer, RPC and validator stop; nothing new is ordered or asserted
```

This stops **everyone**: users cannot deposit or withdraw, the explorer goes stale, and bridge withdrawals already sent stop progressing. It does halt an on-chain attack against the pools on this chain, because no new block is produced. Note that Arbitrum lets anyone push a transaction through the delayed inbox on Arbitrum Sepolia and force its inclusion after the maximum delay, so a long stop is not a guarantee. Restart: `docker compose up -d nitro` (graceful stop allows two minutes, `docker-compose.yml`).

### 2.4 A leaked or suspected key

| Key | Immediate step |
|---|---|
| Relayer (`relayer/secret/relayer.key`) | `docker compose stop relayer`; move the remaining LTH out with a fresh key; then `mv relayer/secret/relayer.key relayer/secret/relayer.key.revoked`, `./relayer-cmd.sh init`, `./relayer-cmd.sh fund 1000` (asks for the deployer key), `docker compose up -d relayer`. |
| Faucet (`faucet/secret/faucet.key`) | `docker compose stop faucet`; same pattern with `./faucet-cmd.sh init` and `./faucet-cmd.sh fund 5000`. |
| Ops wallet (`faucet/secret/ops.key`) | `systemctl stop latheon-ops.path` (the bot can no longer act); `./faucet-cmd.sh ops-init` after moving the old file; `./faucet-cmd.sh fund-ops 200000`. |
| Batch poster or validator (`chain/secret/`) | Requires the rollup owner (deployer key) to change the allowed batch poster or validator on Arbitrum Sepolia, then a new node configuration. Not scripted today: stop the node (§2.3) and treat as S1. |
| Deployer key | S1. Everything the key owns (rollup, chain owner, token, bridge) is at risk and there is no timelock to delay an attacker. Move remaining funds the key holds; announce at once that the chain and bridge must be considered compromised; plan a fresh chain. |
| Telegram bot token | Revoke it with BotFather, set the new token in `.env` and in the GitHub secrets, `docker compose up -d bot`. |

When moving a key file, keep it (renamed) until the incident is closed: it is evidence.

**Before typing the deployer key after a suspected service compromise.** `./relayer-cmd.sh fund`, `./faucet-cmd.sh fund` and `fund-ops` run the code in `relayer/` and `faucet/`, the same folders the running services use. If a service may have been compromised, first make sure that code is exactly what is in git, and only then run a command that asks for the deployer key:

```bash
docker compose stop relayer faucet
git status --porcelain relayer faucet       # must print nothing except relayer/secret and faucet/secret (ignored by git)
git diff --stat HEAD -- relayer faucet      # must be empty
sudo rm -rf relayer/node_modules faucet/node_modules   # reinstalled from package-lock.json by the next command
```

If anything differs, keep a copy for the review, restore with `git checkout -- relayer faucet`, and look at it before going on.

## 3. Communicate

- **First notice within the hour for S1, same day for S2:** what is affected, what users should not do (for example: do not deposit into pool X, do not use the bridge page), what is safe (for example: notes stay withdrawable), when the next update will come. No speculation about cause, no blame.
- **Channels:** explorer banner (§2.1), a pinned GitHub issue in `latheon-network/Latheon` (no exploit details), the project's X account, and the website if an archive is uploaded.
- **Vulnerability details stay private** until a fix is deployed and users had time to act (`SECURITY.md`, responsible disclosure). Do not paste proofs of concept, transactions that teach the attack, or key material into issues, commits or chats.
- **Reporters:** acknowledge reports to latheon.protocol@gmail.com and agree on disclosure timing.

## 4. Fix

- **Contracts or circuits:** the deployed pools cannot be changed. A fix means new contracts (and for a circuit change, a new verifier and new keys), deployed next to the old ones, with the old ones marked frozen as in §2.1 — the path taken for V7 (`docs/dev-ceremony-v5.md`). Before deploying, run the local suites with real proofs (`test/native-v7`, `test/demo-e2e`, `test/distribution`).
- **Services:** fix in `l2-eval-ci`, then on the server:

  ```bash
  cd ~/l2-eval-ci && git pull && cd testnet
  docker compose up -d relayer faucet bot
  ```

- **Node and chain:** `docker compose restart nitro`; batch poster or validator out of ETH: `./topup-cmd.sh batch-poster 0.1`, `./topup-cmd.sh validator 0.05` (ask for the deployer key).
- **Unfreeze** only after the fix is verified: revert the `frozen` flags or the removed `bridge` entry, rebuild, preview, upload; remove the explorer banner.

## 5. Review (within a week)

- A private, blameless write-up: timeline, root cause, what detected it and how fast, what was missing (monitoring, tooling, access), and follow-ups with owners.
- Public part: a short note in `SECURITY.md` under *Past findings* and, where relevant, `THREAT-MODEL.md` and `STATUS.md`, in the same style as the V7 entry: what was wrong, what was affected, how it was fixed — without a recipe.
- Add a check to `monitor/check.sh` or the bot for whatever would have caught it earlier.
- Update this document.
