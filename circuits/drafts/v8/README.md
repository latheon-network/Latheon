# V8 circuit drafts (measurement prototypes, not reviewed, no keys)

These files exist only to measure the options in `docs/v8-design.md`. They are not the V8 circuits, have not been
reviewed, and no proving keys were made from them except throwaway ones for timing (deleted). Do not deploy them.

- `v8_common.circom`: domain tags, a Merkle checker with untagged or tagged nodes, `WithdrawV6(levels, taggedTree, asp)`, `DiscloseLink`.
- `w_a`: tags on commitment and nullifier, untagged tree. `w_b`: tagged tree nodes. `w_c`, `w_d`: as a / b plus an optional association-set tree.
- `dl`: `disclose_link` (commitment ↔ nullifier, bound to chain and pool and to an auditor's code).

Compile (circom 2.2.3, circomlib 2.0.5 linked as `lib/circomlib`): `circom w_a.circom --r1cs --wasm -l lib -o build`.
Time: `node measure.js build withdraw_v5 w_a w_b dl` (needs `withdraw_v5.r1cs` and its wasm in `build` too).
