# Throughput test of the Latheon test chain (30–31 October 2026, V7)

_Corrected on 31 October 2026: the first deposit runs were capped by the test client's request batching; see part 2._

Testnet only. All load came from scripts on the same server as the chain; the wallets, their timing and their behaviour were chosen by us. Scripts: `testnet/loadtest/loadtest.js` and `testnet/loadtest/flood.js` in `latheon-network/l2-eval-ci`.

The earlier load tests (`loadtest-2026-10-27.md`, `loadtest-2026-10-29-v7.md`) spread the steps over a day or two and never pushed the chain. This run looked for the limit, in three parts.

## 1. The full flow, compressed

The same load-test script as round 2 (faucet, deposits, withdrawals through the relayer and from a wallet), with the schedule compressed.

| Run | Wallets | Steps | Failed in the end | Pace |
|---|---|---|---|---|
| 1 h schedule, 4 at once | 200 | 1,011 | 0 | ≈ 17 steps/min (the schedule, not the server, was the limit) |
| 15 min schedule ("burst"), 8 then 16 at once | 300 | 1,615 | 0 | up to ≈ 41 steps/min |

The burst first failed hundreds of steps: the test's master wallet funds the test wallets, and parallel sends from it reached the node out of nonce order. One refused send left a gap that failed every later one, and the wallets it should have funded then failed their deposits. This was a fault in the test script, not in the chain, relayer or faucet. The fix (sends from the master wallet go out one at a time, in nonce order) is in `l2-eval-ci` 80c635a; after it, every failed step ran again and passed.

The limit in this part was the server's processor, and most of it was taken by the load generator itself: it builds the zero-knowledge proofs (2–4 of the 8 cores at 16 steps at once). Real users build proofs in their browsers. The node never went above about 10 % of a core and the relayer above about 2 %.

Privacy, as in the earlier rounds (simulation): simple public-data heuristics linked 8 % of withdrawals in the 1 h run and 7 % in the burst, every self-paid one, 15–24 % of hasty ones, 5–7 % of typical ones. In the burst, 5 of 632 withdrawals by "careful" wallets were linked (0.8 %), the first time any were: with the schedule compressed their wait shrank from 2–20 hours to 2.5–25 minutes. Waiting is the protection.

## 2. Deposits and plain transfers without proofs

Deposits need no proof, so the generator stays light and the chain itself is measured. Wallets sent deposits into the V7 1 LTH pool (or plain 1-wei transfers, the usual "transactions per second" yardstick) as fast as the chain confirmed them, in stages of rising concurrency.

**Correction (31 October, same day).** The first runs of this part (5-minute stages, below as "first runs") put every call through the client library's default batching: ethers packs concurrent calls into one HTTP request, and a Nitro node answers `eth_sendRawTransaction` only once the transaction is sequenced, so the sends of one batch entered the chain one by one. That capped them at one transaction per block (about 240 a minute) for deposits and transfers alike, and two per block at 64 wallets. The cap was our test client, not the chain. With one HTTP request per call (`l2-eval-ci` de4b8a7), as separate users send them, the same chain did many times more.

**One HTTP request per call (3-minute stages):**

| Transaction | Wallets at once | Confirmed | Failed | Per minute | Per second | Confirmation median | p95 | Explorer behind (max blocks) |
|---|---|---|---|---|---|---|---|---|
| deposit | 8 | 4,013 | 0 | 1,333.8 | 22.2 | 0.28 s | 0.58 s | 4 |
| deposit | 16 (8 active after 1.5 min) | 4,809 | 0 | 1,598.3 | 26.6 | 0.48 s | 0.78 s | 4 |
| deposit | 32 (24 active) | 6,643 | 0 | 2,207.9 | 36.8 | 0.59 s | 0.99 s | 4 |
| deposit | 64 (48 active) | 7,186 | 508 | 2,380.9 | 39.7 | 1.10 s | 1.69 s | 4 |
| transfer | 8 | 5,745 | 0 | 1,907.6 | 31.8 | 0.25 s | 0.27 s | 1 |
| transfer | 16 | 11,498 | 0 | 3,819.9 | 63.7 | 0.24 s | 0.27 s | 4 |
| transfer | 32 | 21,818 | 0 | 7,227.9 | 120.5 | 0.24 s | 0.41 s | 4 |
| transfer | 64 | 23,262 | 0 | 7,682.8 | 128.0 | 0.48 s | 0.56 s | 3 |

Notes on this table:
- The deposit wallets were funded with 700 LTH each and spend 1 LTH per deposit, so the first 8, then 16 wallets ran out during the stages: fewer wallets were sending than the stage name says (in brackets).
- The 508 failed deposits at 64 wallets all failed with "could not coalesce error" (the client could not parse the node's error). Not yet diagnosed. One candidate: the run's execution gas was far above the chain's speed limit (below), which makes the chain raise its base fee, and a fee estimated a moment earlier may no longer be enough. Unconfirmed.
- Transfers stayed at one block of confirmation (about 0.25 s) up to 32 wallets, then reached a ceiling of about 128 a second at 64 wallets (confirmation doubled to two blocks). What sets that ceiling is not established; the load generator ran on the same server.

Measured gas: one deposit used 5,042,091 gas, of which 4,251,840 (84 %) was the charge for publishing data to the parent chain, so about 790,000 is execution. A plain transfer executes 21,000 gas. At 39.7 deposits a second the chain executed about 31 million gas a second, more than four times its configured speed limit of 7,000,000 gas a second (a target: above it the chain raises its base fee, it does not refuse transactions; the gas limit per block is 32,000,000). Plain transfers at 128 a second executed only about 2.7 million gas a second, so for transfers the ceiling is per transaction, not gas.

**First runs, with batching (one or two transactions per block, the client's limit):**

| Transaction | Wallets at once | Confirmed | Failed | Per minute | Confirmation median |
|---|---|---|---|---|---|
| deposit | 8 / 16 / 32 / 64 | 1,184 / 1,136 / 1,120 / 2,086 | 0 | 233.6 / 224.1 / 219.5 / 406.6 | 2.0 / 4.1 / 8.5 / 12.9 s |
| transfer | 8 / 16 / 32 / 64 | 720 / 720 / 736 / 1,478 | 0 | 234.2 / 239.5 / 239.4 / 462.0 | 2.0 / 4.0 / 8.0 / 12.5 s |

The explorer stayed within a few blocks of the chain in every run.

## 3. Withdrawals through the relayer, proofs made in advance

400 `withdraw_v5` proofs were made beforehand for notes from part 2 (0.6 s each on the server; the pool's root did not change meanwhile, so they stayed valid), then sent to the relayer at 8, 16 and 32 requests at once.

| Requests at once | Answers | Relayed/min | Answer median | p95 | Confirmed on chain |
|---|---|---|---|---|---|
| 8 | 120 × 200 | 241.7 | 2.0 s | 2.0 s | 120 of 120 |
| 16 | 120 × 200 | 241.2 | 4.0 s | 4.0 s | 120 of 120 |
| 32 | 31 × 200, 89 × 503 | 249.7 | 3.7 s | 7.2 s | 31 of 31 |

The relayer sends from one key, one transaction at a time and waits for each, so it stays at about one withdrawal per block, about 240 a minute, however many requests wait (the burst client's own batching does not matter here: the relayer takes requests one by one). Its queue holds 30: at 32 requests at once the rest were refused at once with 503, as designed, and every accepted withdrawal was confirmed. Ways to raise this later: several relayer keys, or more notes per transaction with `withdrawMany` (up to 16).

## Found along the way

- A deposit's gas depends on which tree slots it writes, and another deposit landing first can change that. On a local chain, concurrent deposits into one pool with gas set exactly to the estimate reverted for lack of gas; the test sets a 30 % margin. The demo currently sends deposits with the wallet's estimate and no margin, so two users depositing into the same pool at the same moment could see a deposit revert. Open item for the next demo release.
- The proof step of the test script did not exit (snarkjs keeps worker threads); fixed.

## What this does not show

- The chain's real limit for transactions that carry proofs: in part 1 the generator ran out of processor first. A generator on a separate machine would measure it.
- The ceilings in part 2 (about 40 deposits and 128 transfers a second on one server): the generator shared the server with the chain, so these are lower bounds for the chain, not its limit.
- Real users: these are our wallets with behaviour we chose.
- Anything about a production chain: one server, one sequencer and one validator run by us.
