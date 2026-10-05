# Distribution pool and composable privacy: design (v0.3)

**Status:** design only, not implemented. Supersedes v0.2. All numbers below come from a toy model
(`tools/privacy-simulation/privacy_sim.py`); they compare design options under explicit assumptions and are
**not** guarantees of privacy.

**Changes from v0.2:** the split rule is now justified by evidence instead of assumed; random composition is
rejected; deposit rounding, a wallet-side withdrawal planner and pool-activity warnings are added; the queue is
demoted to an optional later phase.

## 1. Goal

Accept arbitrary deposit amounts while keeping the contracts' view simple: the fixed-denomination pools
(100 / 50 / 10 / 1, already deployed as V5) only ever see fixed amounts. The question this document answers is
which choices around that make withdrawals harder to link to deposits, and which do not.

## 2. Mechanism

- **Pools:** the existing V5 fixed-denomination pools. No new circuit.
- **DistributionPool (new contract):** accepts an arbitrary amount A and inserts commitments into the fixed pools
  according to a split rule (section 4, D1).
- **Withdrawing part of a deposit:** withdraw the needed notes with the existing `withdraw()`. The notes you do
  not withdraw simply stay available ("change" needs no extra proof). Notes are never reused: each is spent once.
- **Bridge:** the same pattern can be applied to the L1 to L2 transfer (a distribution step on L1, fixed pools on L2).
  Not designed in detail here.

## 3. Evidence: what makes a withdrawal linkable (toy model)

**Observer model.** Sees every deposit (time, amount, and note composition unless stated otherwise) and every
withdrawal group (notes paid to one address at one time: their denominations and the time). Guesses uniformly among
deposits that could explain the group. Metric: expected share of correct guesses. **Lower is better.**
Not modelled: gas prices, address reuse, wallet fingerprints, off-chain data, smarter statistics.

**Table 1: does composition matter?** (1500 deposits over 30 days, uniform amounts)

| Split | User behaviour | Observer success | Notes per deposit |
|---|---|---|---|
| Canonical (greedy), composition visible | withdraws everything at once | 86% | 11.7 |
| Random, composition visible | withdraws everything at once | 99% | 26.7 |
| Random, composition hidden | withdraws everything at once | 86% | 26.7 |
| Canonical, composition visible | withdraws in parts, different addresses and times | 0% | 11.7 |
| Random, composition visible | withdraws in parts, different addresses and times | 1% | 26.7 |

**Table 2: what moves the needle?** (canonical split, user withdraws everything at once; observer success)
Rows: deposit amounts rounded down to a multiple of q. Columns: delay before notes become withdrawable.

Busy pool, about 50 deposits per day:

| | 0 d | 3 d | 7 d | 14 d |
|---|---|---|---|---|
| q=1 | 86% | 80% | 75% | 69% |
| q=10 | 31% | 23% | 18% | 15% |
| q=50 | 7% | 5% | 4% | 3% |
| q=100 | 3% | 2% | 2% | 1% |

Quiet pool, about 7 deposits per day:

| | 0 d | 3 d | 7 d | 14 d |
|---|---|---|---|---|
| q=1 | 98% | 97% | 97% | 96% |
| q=10 | 81% | 76% | 69% | 62% |
| q=50 | 40% | 31% | 25% | 19% |
| q=100 | 22% | 16% | 13% | 10% |

**Findings (within the model):**

1. **The total amount is the fingerprint.** It is public at deposit time and equals the sum of the withdrawals if the
   user withdraws everything at once.
2. **Random composition does not help.** With visible composition it makes each deposit unique (99% vs 86%) and
   costs 2.3 times as many notes. With hidden composition it is merely harmless (86%, equal to canonical).
   A canonical form makes users who deposit the same amount look identical, which is a form of anonymity.
3. **Withdrawal behaviour is the largest lever.** Splitting a deposit across addresses and times takes the
   observer's success from 86% to about 0%.
4. **Rounding deposit amounts is the strongest design lever** (q=10: 31%, q=50: 7%, q=100: 3% in a busy pool).
5. **A queue delay helps little on its own** (86% to 69% at 14 days).
6. **Pool activity dominates everything.** The same settings are far worse in a quiet pool. Today the Latheon
   pools hold almost only the team's own test deposits, so none of these protections is yet in effect in practice.

## 4. Decisions

- **D1. Canonical split.** Greedy over [100, 50, 10, 1]. No random composition, no contract-chosen randomness
  (on-chain randomness is public and manipulable and would add nothing).
- **D2. Wallet withdrawal planner (client only).** By default never withdraw the deposit total as one group to
  one address. Offer several addresses and delays, avoid reproducing the deposit's pattern, and warn when the
  chosen plan would be identifying. This is the largest effect and needs no contract change.
- **D3. Deposit rounding.** The deposit UI rounds the amount down to a step (proposed default 10; stronger
  presets 50 and 100). The remainder stays in the user's wallet. An "exact amount" option stays available behind
  an explicit warning.
- **D4. Pool activity indicators.** Show recent deposits per pool and warn when a pool is quiet.
- **D5. Queue.** Optional, later. Worth considering only together with the measures above.

## 5. Rejected or deferred

- **Random composition:** rejected (finding 2).
- **Hidden-amount notes** (Zcash or Penumbra style value commitments with range proofs): would remove the amount
  fingerprint entirely, but need a different circuit and a new trusted setup. Deferred as a long-term option.
- **Steering notes into thin pools for balance:** a different goal. Anonymity is counted in independent
  depositors, not notes, so several notes from one user do not enlarge a pool's set.

## 6. Open questions

- Which real-world signals outside this model matter most for our users?
- Default rounding step; whether the contract should enforce it or only the UI recommends it.
- How to present the remainder left outside the pool.

## 7. Implementation order

1. Fixed-denomination pools (done: V5 deployed on three testnets).
2. Wallet: storage for several notes, coin selection and the withdrawal planner (client only).
3. Deposit UI: rounding, warnings, pool-activity indicators.
4. DistributionPool contract (canonical split, no queue).
5. Optional: queue; bridge variant.

## 8. Reproducing the numbers

`python3 tools/privacy-simulation/privacy_sim.py` prints both tables (about a minute on a laptop). The model's
assumptions are in the script's header and are meant to be challenged.
