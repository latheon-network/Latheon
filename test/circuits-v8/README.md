# V8 circuit tests (withdraw_v6, disclose_v2, disclose_link)

Checks for the V8 circuits in `circuits/` (`docs/v8-design.md`). They build the circuits from source, make
**throwaway** Groth16 keys from `circuits/ptau/pot14_final.ptau` (single party, no contribution, deleted at the end:
never use them for anything) and test real proofs. Nothing talks to a network. Internal tests, not an audit.

```
cd test/circuits-v8 && npm install
CIRCOM=/path/to/circom-2.2.3 npm test      # about 2 minutes on 2 vCPUs
```

`CIRCOM` must point to the circom 2.2.3 binary (release `circom-linux-amd64` of iden3/circom). Exit code 0 means every
check passed.

What is checked:

1. **Tags.** `TAG_COMMIT`, `TAG_NULL`, `TAG_DISC` in `circuits/latheon_v8.circom` equal `keccak256(string) mod p` for
   `latheon.v8.commit`, `latheon.v8.null`, `latheon.v8.disc`.
2. **withdraw_v6.** An honest proof for a note at index 5 of a small tree verifies, and its public signals are
   `[root, nullifierHash, ctx, extDataHash]` as computed by the reference code in `run.js` (the same formulas the SDK and
   the contracts must use: `ctx = keccak256(abi.encode("latheon.v8.ctx", chainId, pool)) mod p`,
   `extDataHash = keccak256(abi.encode(recipient, relayer, fee, reference, destChainId)) mod p`). Each public signal
   changed by +1 or set to 0 is rejected; the proof with the context of another pool or another chain is rejected; an
   extDataHash with any one field changed (recipient, relayer, fee ± 1 wei or 0, reference, destChainId, recipient and
   relayer swapped) is rejected. The witness generator refuses a nullifier of another pool or key, a wrong viewKey, a
   V7-format commitment and a foreign root.
3. **Path selectors are bits.** A copy of `withdraw_v6` without the bit check is built in the test; it has the same
   wires and exactly 20 constraints fewer. Forged witnesses with selectors 2, p−1 and (p+1)/2 on levels 0, 9 and 19
   (a note that was never in the tree) satisfy the copy's r1cs but not the r1cs of `withdraw_v6`, and the
   `withdraw_v6` witness generator refuses them.
4. **disclose_v2.** Public signals are commitment, disclosureTag and auditorNonce only (no nullifier); altered signals
   are rejected; another auditor's code, another note's commitment and a tag from another viewKey are refused.
5. **disclose_link.** Its nullifier equals the one `withdraw_v6` publishes for the same note and pool; altered signals
   are rejected; a nullifier of another pool or note, another note's commitment and a wrong auditor code are refused;
   its proof does not pass as a `disclose_v2` proof.
6. **Timing.** Median of 3 proofs per circuit on the machine running the test.

Result on 24 November 2026 (2 vCPUs, Intel Xeon 2.10 GHz, Node 22): 44 passed, 0 failed; `withdraw_v6` 11,611
constraints and 1.18 s per proof, `disclose_v2` 1,210 and 0.22 s, `disclose_link` 1,815 and 0.24 s.
