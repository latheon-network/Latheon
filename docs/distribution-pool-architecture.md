# Distribution pool and composable privacy: design (v0.5)

**Status:** the router contract (`contracts/LatheonDistributionPool.sol`) and the client mirror of its split rule
(`sdk/distribution.js`) are implemented and tested on a local EVM (`test/distribution`). **Deployed on four testnet token sets and checked by hand with real proofs (addresses and transactions: `docs/distribution-pool-deployments.md`); not reviewed by anyone else.** The wallet side is built in the demo for D3 (rounding chosen by the user, exact amount preselected), one master key per deposit, and withdrawal by amount and key (`sdk/distribution.js`, `test/distribution/wallet.js`, `test/demo-e2e/router-e2e.js`; run live on Ethereum Sepolia). D2 (a planner that proposes several addresses and delays) and D4 (pool-activity indicators) are not built; the demo offers separate notes for unlinked payouts and warns that one `withdrawMany` links its notes. Supersedes v0.3. All numbers below come from a toy model
(`tools/privacy-simulation/privacy_sim.py`); they compare design options under explicit assumptions and are
**not** guarantees of privacy.

**Changes from v0.5 (October 2026):** status only: the wallet side and the demo are built (see above). No change to the contract or the decisions.

**Changes from v0.4:** the router gains `withdrawMany` (several ordinary V5 withdrawals in one transaction); section 9
records it, its tests (48 checks) and its limits. Nothing else changed.

**Changes from v0.3 (carried over):** section 2 now describes the implemented contract; section 7 marks step 4 as done locally;
section 6 gains the questions the implementation raised; section 9 (new) records what was built, measured and what it
does not do. The evidence and decisions (sections 3 to 5) are unchanged.

**Changes from v0.2 (carried over):** the split rule is now justified by evidence instead of assumed; random composition is
rejected; deposit rounding, a wallet-side withdrawal planner and pool-activity warnings are added; the queue is
demoted to an optional later phase.

## 1. Goal

Accept arbitrary deposit amounts while keeping the contracts' view simple: the fixed-denomination pools
(100 / 50 / 10 / 1, already deployed as V5) only ever see fixed amounts. The question this document answers is
which choices around that make withdrawals harder to link to deposits, and which do not.

## 2. Mechanism

- **Pools:** the existing V5 fixed-denomination pools. No new circuit.
- **DistributionPool (new contract, implemented):** a router that accepts an arbitrary amount A and inserts commitments
  into the fixed pools according to a split rule (section 4, D1). It has no owner, no fee, no admin and no storage that
  changes after construction, and it holds no balance between transactions (section 9).
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
- **D3. Deposit rounding, chosen by the user.** The deposit UI shows the choice side by side: distribute the exact amount, or round it down to a step (presets 10, 50, 100; the remainder stays in the user's wallet), each with a plain note of what it gives. Rounding is the strongest lever in the model (section 3, finding 4) and the exact amount is the more identifying option, and the UI says so. The contract does not enforce either: it accepts any amount that is a multiple of the smallest denomination. Which option is preselected is still open.
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
- Which D3 option is preselected in the demo: currently the exact amount, with rounding one click away; the contract does not enforce rounding. Whether that default is right is open.
- How to present the remainder left outside the pool.
- Wallet: one fresh spendKey/viewKey pair per note, and storage for several notes per deposit (step 2 of section 7).
  The router refuses a repeated commitment inside one call, but it cannot see a repeat across calls.
- Whether `MAX_NOTES = 32` is the right bound once real L2 gas prices are measured (section 9).

## 7. Implementation order

1. Fixed-denomination pools (done: V5 deployed on three testnets).
2. Wallet: one master key per deposit, coin selection by amount (**done in the demo**); a withdrawal planner with several addresses and delays (not done).
3. Deposit UI: rounding and warnings (**done**); pool-activity indicators (not done).
4. DistributionPool contract (canonical split, no queue). **Done and deployed on four testnet token sets.**
5. Optional: queue; bridge variant.

## 8. Reproducing the numbers

`python3 tools/privacy-simulation/privacy_sim.py` prints both tables (about a minute on a laptop). The model's
assumptions are in the script's header and are meant to be challenged.

## 9. What was built (v0.4)

**Contract:** `contracts/LatheonDistributionPool.sol`.

- `split(amount)` returns how many notes go to each pool (greedy over the four pool denominations) and the total.
  It reverts for a zero amount or one that is not a multiple of the smallest denomination.
- `deposit(amount, commitments)` pulls `amount` once, then for each pool approves exactly what that pool will pull and
  calls the pool's ordinary `deposit(commitment)` once per note. `commitments` holds one commitment per note, grouped by
  pool, largest first. The allowance is back to zero afterwards and nothing stays in the router.
- Refused: wrong number of commitments, a commitment repeated within the call, more than `MAX_NOTES` (32) notes.
  The whole call is atomic: if one pool rejects its note, notes already placed in other pools are rolled back.
- The constructor checks that all four pools hold the same token and that the denominations are strictly descending and
  each divides the previous one (this is what keeps the greedy split exact).
- `withdrawMany(items, recipient)` takes up to `MAX_WITHDRAWALS` (16) items, each a pool index (0 = largest) and an
  ordinary V5 proof, and forwards each to that pool's `withdraw()`. The pool verifies the proof, which is bound to
  `recipient`, and pays `recipient` directly: the router never holds tokens, so it cannot redirect money. Atomic: if
  any note is refused (already spent, unknown root, invalid proof, repeated in the batch) nothing is withdrawn. Any
  address may send the call; the notes' owner is whoever holds the keys.
- The V5 pools and the circuit are **not changed**. Every note is an ordinary V5 note, withdrawn with the ordinary
  `withdraw()` of its pool, or through `withdrawMany`.

**Client:** `sdk/distribution.js` mirrors the split rule (`canonicalSplit`, `noteOrder`) and the rounding of decision D3
(`roundDown`). The contract is the source of truth; the test checks that both agree.

**Measured on a local EVM** (`test/distribution`, 48 checks, 50 with `FULL_TREE=1`, real Groth16 proofs): gas of one `deposit()` call.

| Notes | Gas (approx.) | Gas per note (approx.) |
|---|---|---|
| 1 | 404,700 | 404,700 |
| 3 | 1,294,500 | 431,500 |
| 14 | 4,378,700 | 312,800 |
| 32 | 9,302,200 | 290,700 |

`withdrawMany` for 3 notes (one per pool) measured about 775,000 gas, roughly 258,000 per note, against about 276,000 for a
separate transaction (the saving is the per-transaction base cost, not the proof check).

The figures differ by a few dozen gas between runs (random commitments change the call data), so they are rounded.

These are local-EVM figures, not live-network readings. Gas on each live network is priced differently (see
`docs/gas-benchmark.en.md` for the V5 withdraw readings), so `MAX_NOTES` should be revisited after a measurement there.

**What this does not do (read this before relying on it):**

- **It does not by itself make a withdrawal harder to link.** The total amount is public and so is the composition of the
  notes: they are emitted by one transaction from one sender. The toy-model result of section 3 stands: what reduces
  linkability is rounding the amount (D3) and withdrawing in parts to different addresses and times (D2), and those live in
  the wallet, which is not built yet.
- **It does not enlarge an anonymity set.** Several notes from one user count as one depositor (section 5).
- **`withdrawMany` links.** Several notes paid to one address in one transaction are visibly one group. It is a
  convenience for people who do not need unlinking; the wallet should offer separate withdrawals, at different times and
  to different addresses, as the private mode (D2).
- **It adds a contract to the audit scope.** It is small and holds nothing, but no one outside the project has reviewed it,
  and nothing in the repository has had an independent audit.
- **Testnets only, and not deployed.** The pools it would sit on hold mostly the team's own test deposits (section 3, finding 6).

