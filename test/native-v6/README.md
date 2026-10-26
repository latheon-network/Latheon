# V6 native-coin pool and router tests

End-to-end tests for `LatheonShieldedPoolV6Native` and `LatheonDistributionPoolV6Native` with **real Groth16 proofs**
(`withdraw_v4`) on a local EVM (ganache). Built from `test/native` (the V5 suite): every V5 check is kept, adapted to the
V6 interface, and V6 adds checks for what changed. Everything is read from this repository.

```
cd test/native && npm install && cd ../native-v6
npm test        # uses ../native/node_modules
```

Takes several minutes (it makes a few hundred deposits). Exit code 0 means every check passed.

## What V6 changes and what is checked for it

- **Capacity:** 20-level trees (1,048,576 deposits per pool instead of 256). Checked: `LEVELS` is 20, `zeros(20)` is the
  Poseidon cascade, and deposit #301 lands at leaf 300 and is withdrawn with a proof (a V5 pool stops at 256).
- **Root history:** the last 100 roots instead of 30. Checked: a proof made before 99 more deposits still withdraws; after
  100 more it is refused ("Unknown root") and a fresh proof for the same note withdraws.
- **Relayer fee in the proof:** `withdraw(…, recipient, relayer, fee)` and `withdrawMany(items with fee, recipient, relayer)`.
  Checked: five public signals; the fee cannot be redirected, raised or dropped; recipient gets denomination − fee and the
  relayer named in the proof gets the fee even when someone else sends the transaction; fee above the denomination and a
  fee without a relayer are refused; a relayer that refuses the coin reverts the whole withdrawal and the note stays
  unspent; router batches with per-note fees.

Local EVM only (solc evmVersion "paris", ganache "shanghai"). It does not replace an independent audit.
