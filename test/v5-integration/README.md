# V5 integration tests

End-to-end tests for `LatheonShieldedPoolV5` with **real Groth16 proofs** on a local EVM (ganache). Everything is read
from this repository: `contracts/` and `circuits/build/`.

```
cd test/v5-integration
npm install
npm test
```

Takes about a minute. Exit code 0 means every check passed.

## What it checks

- **V5:** a proof made for one recipient cannot be replayed to pay another address (rejected with `Invalid proof`);
  the proof carries three public signals and the third equals the intended recipient; denominations 100 / 50 / 10 / 1
  of an 18-decimals token and 100 of a 6-decimals token; the intended recipient receives exactly the denomination;
  a note cannot be spent twice; zero recipient and zero denomination are rejected.
- **V4 (legacy):** a **reproduction of the flaw V5 fixes**: V4 accepts a proof submitted with a different recipient.
  See `docs/withdraw-recipient-binding.md`.

The V2 verifier needed for the V4 reproduction is generated at run time from `circuits/build/withdraw_v2/withdraw_v2_final.zkey`.

## Notes

- Compiled with solc `evmVersion: paris` and run on ganache `shanghai`; dependency versions are pinned in `package.json`.
- A message from ganache about "µWS is not compatible with your Node.js build" is harmless.
- This is a local test. It does not replace an independent audit or a test against live networks.
