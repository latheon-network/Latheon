# Internal ZK review tests

Reproducible checks from an **internal** review of the circuits, keys and verifiers (29 October 2026). This is not an
independent review and not an audit. Everything runs locally: snarkjs proofs against the files committed in
`circuits/build/`, and a ganache EVM inside the test process. Nothing here talks to a live network.

```
cd test/zk-review
npm install
npm test                                     # everything that needs no compiler
CIRCOM=/path/to/circom-2.2.3 npm test        # plus the r1cs-level checks and the withdraw (v1) forgery
node run.js forgery                          # one part: artifacts | forgery | v5 | construction
```

`CIRCOM` must point to the circom 2.2.3 binary (release `circom-linux-amd64` from iden3/circom). With it the tests build
the circuits from `circuits/*.circom` into a temp directory: circomlib 2.0.5 for withdraw, v3, v4, v5; circomlib 2.0.2
with `--O1` for withdraw_v2 and disclose, the combination that reproduces their committed wasm byte for byte.
Takes about 6 minutes (most of it 20-level proofs).

## What is checked

- **`p1-artifacts.js`** — sha256 of each committed wasm/zkey equals `docs/dev-ceremony-v3/v4/v5.md` and (if
  `../l2-eval-ci` or `$L2_EVAL_CI` is present) the hashes in the test chain's build artifact; `verification_key.json`
  equals the key exported from the final zkey and every constant of the Solidity verifier; the public input order is the
  same in the circuit, the verifier and every V6/V7 pool; the zkey header and its A/B coefficient matrices equal the r1cs
  built from source; a fresh build reproduces the committed wasm; `contracts/` and `circuits/` at the deployed commit
  129a4c0 equal this checkout, and solc 0.8.37 rebuilds the bytecode recorded in the l2-eval-ci artifact.
- **`p1-forgery.js`** — the published flaw (THREAT-MODEL §8.0) on every pre-V7 circuit, each with its own committed
  wasm, final zkey and verification key: withdraw_v2, withdraw_v3, withdraw_v4 accept a proof for a commitment that was
  never deposited; the committed `WithdrawVerifierV3`/`V4` accept it; a `V5Native` (withdraw_v3) and a `V6Native`
  (withdraw_v4) pool with three honest deposits are emptied by an account that never deposited. `withdraw.circom` (v1)
  has no committed proving key (its verifier came from a browser setup), so with `CIRCOM` the forgery is shown against
  its r1cs and with a throw-away key.
- **`p1-v5.js`** — withdraw_v5 (V7): a non-binary selector (2 at every level, p-1, (p+1)/2, a random value, several
  levels at once, the full forgery to a pool root) is refused by the v5 witness generator, and the same witness made
  with the v4 wasm and proven with the final v5 key is rejected by the v5 key while the v4 key accepts it; substituted
  or non-canonical (x + p) root, nullifierHash, recipient, relayer and fee are rejected by snarkjs and
  `WithdrawVerifierV5`; a forged proof sent to a V7 pool is refused; honest proofs at leaves 0, 1, 2^19, 2^20-2,
  2^20-1 and alternating bit patterns verify.
- **`p2-construction.js`** — Poseidon: poseidon-lite = the demo's vendored browser bundle = `PoseidonT3.sol` = circomlib
  inside the circuits; the V7 pool's zeros and incremental roots; one note has one nullifierHash; disclosure proofs are
  bound to the auditor's nonce and the commitment; the phase-2 contribution recorded in each zkey.

## What these tests do not cover

The phase-1 powers-of-tau files are not in the repository, so `snarkjs zkey verify` (which checks the C/L and H points
of a key against the circuit) cannot be run from it. All keys come from single-operator development setups.
