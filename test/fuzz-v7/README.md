# V7 property (fuzz) tests

Randomised, reproducible tests of the V7 contracts on a local EVM:

- `LatheonShieldedPoolV7Native` + `LatheonDistributionPoolV7Native` (native coin)
- `LatheonShieldedPoolV7` + `LatheonDistributionPoolV7` (ERC-20, `LatheonToken`)

Everything is compiled from this repository. Local EVM only; this is an internal test, **not an audit**.

```
cd test/fuzz-v7
npm ci
npm test                         # seed 1: part A (400 operations per variant) + part B (real proofs)
SEED=42 OPS=1000 SKIP_REAL=1 npm test    # another seed, longer, part A only
```

The EVM is [anvil](https://book.getfoundry.sh/anvil/) when it is on `PATH` or given as `ANVIL=/path/to/anvil`
(about 20 times faster); otherwise ganache from `node_modules` (works, slow: use a small `OPS`). `GANACHE=1` forces
ganache. Exit code 0 means every check passed; a failure prints the seed, so the same run can be repeated.

| Variable | Default | Meaning |
|---|---|---|
| `SEED` | `1` | seed of the random sequence (any string) |
| `OPS` | `400` | random operations per variant in part A |
| `REAL_OPS` | `24` | random withdrawals with real proofs per variant in part B |
| `SKIP_REAL` | – | `1` runs part A only |
| `ONLY` | – | `native` or `erc20` runs one variant of part A |
| `VERBOSE`, `TRACE`, `DEBUGRPC` | – | print every passed check / every operation / every RPC call (anvil) |

## Part A: random sequences with a binding mock verifier

Four pools (100 / 50 / 10 / 1) and the router per variant, and a random sequence of: direct deposits (sometimes with the
wrong amount or no allowance), router deposits of random amounts (sometimes zero, off-grid, more than 32 notes, a wrong
number of commitments, duplicates, `c` and `c + p`), bursts of 100 deposits into one pool (to push roots out of the
history), single withdrawals and `withdrawMany` with 0..17 notes (duplicates, unknown pool index, spent notes).
Withdrawals use random fees (0, 1, DENOMINATION − 1, DENOMINATION, DENOMINATION + 1, random), a random or zero relayer,
relayer equal to recipient, a zero recipient, a recipient or relayer contract that refuses the coin (native), and roots
that are current, older but still in the history, pushed out, random, or zero.

The verifier is a **test double**: it accepts a "proof" only if `pA[0] == keccak256(abi.encode(pubSignals))` and every
public signal is below the field size (as the real verifier). So it checks that the pools pass exactly
`(root, nullifierHash, recipient, relayer, fee)` and every rule that lives in the contracts; it does not check the circuit.

## Part B: real proofs

The same contracts on `WithdrawVerifierV5` with real Groth16 proofs from `circuits/build/withdraw_v5` (final
development key): random withdrawals with fees 0..DENOMINATION, each also tried with the fee, recipient or relayer
changed by the caller (refused) and again after it succeeded (double spend, refused); the 100-root history (a proof made
before 99 more deposits withdraws, one made before 100 more is refused and a fresh proof for the same note withdraws);
`withdrawMany` with 1, 2, 5..10 and 16 notes, each also with a duplicate note appended and with another recipient
(whole batch refused, nothing moves); a random root and root 0.

## Invariants checked after every operation

- **I1** each pool's balance = (deposits − withdrawals) × denomination, from the test's own count;
- **I2** the router holds nothing and has no allowance left to any pool (ERC-20);
- **I3** `nextIndex` = number of deposits, and the pool's current root = the root of an independent JS Poseidon tree;
- **I4** `nullifierHashes` matches the model (one sampled note per pool each step, all notes at the end): a note is spent at most once;
- **I5** a withdrawal pays the recipient DENOMINATION − fee and the relayer the fee (sum = DENOMINATION), batches add up;
- **I6** a root is accepted only while it is one of the pool's last 100 roots; 0 and random values never;
- **I7** every refused call reverts with the reason the model predicts (static call; some also as real transactions) and changes nothing.

Known limits that the tests confirm rather than flag (`THREAT-MODEL.md` §8.5): a commitment of 0 or ≥ p is accepted
(it can never be withdrawn), and `c` and `c + p` pass the router's duplicate check.

## Results and sanity check (29 October 2026, anvil 1.5.1)

- Seed 1, full run (part A 400 operations per variant + part B): 773 checks, 0 failed, 103 real proofs, about 19 minutes.
- Part A only: seeds 2 and 3 (400 operations per variant) 558 checks each, seed 4 (800) 1,128 checks, 0 failed.
- Seed 6 (part A 100 operations per variant + part B with 4 random withdrawals): 202 checks, 0 failed, 69 real proofs.
- The tests catch deliberate bugs: with the nullifier check removed from the native pool, with a 99-root history, and
  with a fee of 1 wei not paid to the relayer, runs fail (18, 2 and 4 failed checks).

Not covered here: a full tree (2^20 deposits), gas griefing by a contract recipient (§8.5), the circuit itself
(`test/native-v7` checks forged witnesses), and the older pool generations.
