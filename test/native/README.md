# Native-coin pool and router tests

End-to-end tests for `LatheonShieldedPoolV5Native` and `LatheonDistributionPoolNative` with **real Groth16 proofs** on
a local EVM (ganache). Everything is read from this repository: `contracts/`, `circuits/build/` and `sdk/distribution.js`.

```
cd test/native
npm install
npm test
```

Takes a few minutes. Exit code 0 means every check passed (57 checks).

## What the variant is

The V5 pool and the distribution router with the chain's native coin instead of an ERC-20, for a chain whose gas token
is the coin users hold. Same circuit (`withdraw_v3`), verifier, Merkle tree, root history, nullifiers and recipient
binding as V5. Differences: `deposit()` is payable and takes exactly the denomination; `withdraw()` pays with a native
transfer after the nullifier is recorded; `token()` returns `address(0)`; the router's `deposit()` requires
`msg.value == amount` and forwards each note's denomination to its pool. Neither contract has `receive()`.

## What it checks

- **pool:** exact amount only (less, more, nothing refused); a proof pays only its own recipient; zero recipient,
  unknown root and double spend refused; Poseidon library linked correctly; zero denomination refused.
- **native transfers:** a recipient that refuses the coin makes the withdrawal revert, the note stays unspent and is
  later withdrawn with a new proof for another address; a recipient that re-enters `withdraw()` (or the router's
  `withdrawMany()` with the same batch) while being paid is paid once and its re-entry is refused with
  "Note already spent"; plain transfers to a pool or the router are refused; coin forced in with `selfdestruct` changes
  nothing.
- **split, deposit, composability, refusals, atomicity, constructor, withdrawMany:** the same cases as
  `test/distribution`, adapted to the native coin (`msg.value` must equal `amount`; an ERC-20 pool is rejected by the
  native router).
- **accounting:** every pool holds exactly denomination × (deposits − withdrawals).
- **gas:** prints the measured gas of `deposit()` for 1, 3, 14 and 32 notes and of `withdrawMany()` for 1, 2 and 3 notes,
  paid to empty addresses (a native transfer to an address that never held anything costs more than to one that did).

## Notes

- Compiled with solc `evmVersion: paris` and run on ganache `shanghai`; dependency versions are pinned in `package.json`.
- A message from ganache about "µWS is not compatible with your Node.js build" is harmless.
- Gas numbers are from a local EVM; live networks differ (L2s add a data fee).
- This is a local test. It does not replace an independent audit or a test against live networks.
