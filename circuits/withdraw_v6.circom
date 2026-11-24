pragma circom 2.0.0;

include "latheon_v8.circom";

// ---------------------------------------------------------------------------
// WithdrawV6 — the withdrawal circuit of the V8 pools (docs/v8-design.md).
// Testnet only, not audited, not yet deployed.
//
// Public inputs: root, nullifierHash, ctx, extDataHash.
//   root          a root the pool knows.
//   nullifierHash Poseidon(TAG_NULL, spendKey, ctx); the pool records it so a note is paid once.
//   ctx           the pool's context, keccak256(abi.encode("latheon.v8.ctx", chainid, pool)) mod p.
//                 The pool computes it itself and never takes it from the caller, so a proof made
//                 for one pool or chain is refused by every other one (§3).
//   extDataHash   keccak256(abi.encode(recipient, relayer, fee, reference, destChainId)) mod p,
//                 computed by the pool from the arguments it then pays out with (§7). Changing any of
//                 them changes the hash and the proof fails.
// Private inputs: spendKey, viewKey, pathElements, pathIndices.
//
// Changes from withdraw_v5 (V7): tagged 3-input commitment and nullifier, ctx folded into the
// nullifier, one extDataHash instead of recipient/relayer/fee. Unchanged: tree depth 20, untagged
// tree nodes, the bit check on every path selector, Groth16 on BN254.
// ---------------------------------------------------------------------------
template WithdrawV6(levels) {
    signal input root;             // public
    signal input nullifierHash;    // public
    signal input ctx;              // public
    signal input extDataHash;      // public

    signal input spendKey;             // private
    signal input viewKey;              // private
    signal input pathElements[levels]; // private
    signal input pathIndices[levels];  // private

    component commitment = NoteCommitment();
    commitment.spendKey <== spendKey;
    commitment.viewKey <== viewKey;

    component tree = MerkleRoot(levels);
    tree.leaf <== commitment.out;
    for (var i = 0; i < levels; i++) {
        tree.pathElements[i] <== pathElements[i];
        tree.pathIndices[i] <== pathIndices[i];
    }
    root === tree.root;

    component nullifier = NoteNullifier();
    nullifier.spendKey <== spendKey;
    nullifier.ctx <== ctx;
    nullifierHash === nullifier.out;

    // extDataHash enters no other constraint; the square keeps it bound to the proof (as the
    // recipient/relayer/fee squares did in withdraw_v5).
    signal extDataHashSquare;
    extDataHashSquare <== extDataHash * extDataHash;
}

component main {public [root, nullifierHash, ctx, extDataHash]} = WithdrawV6(20);
