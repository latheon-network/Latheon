# Throughput test of the Latheon test chain (30–31 October 2026, V7)

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

## 2. Deposits without proofs

Deposits need no proof, so the generator stays light and the chain itself is measured. Wallets sent deposits into the V7 1 LTH pool as fast as the chain confirmed them, in four 5-minute stages.

| Wallets at once | Confirmed | Failed | Deposits/min | Confirmation median | p95 | Explorer behind (max blocks) |
|---|---|---|---|---|---|---|
| 8 | 1,184 | 0 | 233.6 | 2.0 s | 2.1 s | 8 |
| 16 | 1,136 | 0 | 224.1 | 4.1 s | 4.6 s | 16 |
| 32 | 1,120 | 0 | 219.5 | 8.5 s | 9.8 s | 4 |
| 64 | 2,086 | 0 | 406.6 | 12.9 s | 15.6 s | 4 |

Every deposit at 8, 16 and 32 wallets went into its own block (about 4 blocks a second). At 64 wallets there were 1.75 deposits per block on average and never more than 2. One deposit used 5,042,091 gas, of which 4,251,840 (84 %) was the charge for publishing data to the parent chain. The chain's gas limit per block is 32,000,000 (speed limit 7,000,000 gas a second), so by gas about six deposits would fit in a block: gas is not what held throughput at one or two per block. We have not established what does; the sequencer's own pace is the leading candidate, not a measured fact.

During the 64-wallet stage the node used about 43 % of a core and the explorer about 45 %, and the explorer stayed within a few blocks of the chain.

## 3. Withdrawals through the relayer, proofs made in advance

400 `withdraw_v5` proofs were made beforehand for notes from part 2 (0.6 s each on the server; the pool's root did not change meanwhile, so they stayed valid), then sent to the relayer at 8, 16 and 32 requests at once.

| Requests at once | Answers | Relayed/min | Answer median | p95 | Confirmed on chain |
|---|---|---|---|---|---|
| 8 | 120 × 200 | 241.7 | 2.0 s | 2.0 s | 120 of 120 |
| 16 | 120 × 200 | 241.2 | 4.0 s | 4.0 s | 120 of 120 |
| 32 | 31 × 200, 89 × 503 | 249.7 | 3.7 s | 7.2 s | 31 of 31 |

The relayer sends from one key, one transaction at a time, so it stays at about one withdrawal per block, about 240 a minute, however many requests wait. Its queue holds 30: at 32 requests at once the rest were refused at once with 503, as designed, and every accepted withdrawal was confirmed. Ways to raise this later: several relayer keys, or more notes per transaction with `withdrawMany` (up to 16).

## Found along the way

- A deposit's gas depends on which tree slots it writes, and another deposit landing first can change that. On a local chain, concurrent deposits into one pool with gas set exactly to the estimate reverted for lack of gas; the test sets a 30 % margin. The demo currently sends deposits with the wallet's estimate and no margin, so two users depositing into the same pool at the same moment could see a deposit revert. Open item for the next demo release.
- The proof step of the test script did not exit (snarkjs keeps worker threads); fixed.

## What this does not show

- The chain's real limit for transactions that carry proofs: in part 1 the generator ran out of processor first. A generator on a separate machine would measure it.
- Real users: these are our wallets with behaviour we chose.
- Anything about a production chain: one server, one sequencer and one validator run by us.
