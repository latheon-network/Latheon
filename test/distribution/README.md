# Distribution pool tests

End-to-end tests for `LatheonDistributionPool` on top of the **real V5 pools**, with **real Groth16 proofs**, on a
local EVM (ganache). Everything is read from this repository: `contracts/`, `circuits/build/` and `sdk/distribution.js`.

```
cd test/distribution
npm install
npm test
```

Takes a few minutes. Exit code 0 means every check passed. Set `FULL_TREE=1` to also fill a real pool to its 256-note
capacity and prove the rollback on the actual "Tree is full" revert (adds ten minutes or more).

## What it checks

- **split:** the on-chain rule equals the client mirror (`sdk/distribution.js`) for known amounts and 300 random ones,
  and the notes always add up to exactly the amount. Zero and off-grid amounts are rejected.
- **deposit:** an arbitrary amount becomes the canonical notes in the right pools (160 = 100 + 50 + 10;
  99 = 50 + 4 x 10 + 9 x 1); the router holds nothing afterwards and has no allowance left; the pools' `Deposit`
  events carry the commitments in the documented order; the `Distributed` event reports depositor, amount, notes.
- **composable:** every note is an ordinary V5 note. The three notes of a 160 deposit are withdrawn with the ordinary
  `withdraw()` to three different addresses, each with its own real proof. Nothing is left in the router.
- **refusals:** wrong number of commitments, the same commitment twice, zero amount, amount off the grid, more than
  `MAX_NOTES` notes, no allowance, no balance. After each, the pools, the user and the router are exactly as before.
- **atomicity:** if one pool rejects its note, the whole call reverts and the notes already placed in other pools are
  rolled back (a test double stands in for the rejecting pool; with `FULL_TREE=1` a real pool is filled to capacity).
- **constructor:** a pool of another token, a wrong order, denominations that do not divide each other, a zero address.
- **withdrawMany:** three notes from three pools are paid in one transaction (sent by a third party); only 2 of 3 can be
  taken and the third stays withdrawable; one spent note reverts the whole batch and the rest stay spendable; proofs
  made for one address do not pay another; zero recipient, empty list, pool index out of range, the same note twice and
  more than 16 items are refused.
- **decimals:** the same on a 6-decimals token (USDG-like).
- **gas:** prints the measured gas of one `deposit()` for 1, 3, 14 and 32 notes (this is what `MAX_NOTES = 32` is based on).

## Notes

- Compiled with solc `evmVersion: paris` and run on ganache `shanghai`; dependency versions are pinned in `package.json`.
- A message from ganache about "µWS is not compatible with your Node.js build" is harmless.
- Gas numbers are from a local EVM; live networks differ (L2 gas is priced differently), see `docs/gas-benchmark.en.md`
  for the V5 pool readings.
- This is a local test. It does not replace an independent audit or a test against live networks.
