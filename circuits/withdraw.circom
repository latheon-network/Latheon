pragma circom 2.0.0;

include "circomlib/poseidon.circom";
include "circomlib/mux1.circom";

// ---------------------------------------------------------------------------
// MerkleTreeChecker
// ---------------------------------------------------------------------------
// Proves that `leaf` is included in a Merkle tree with the given `root`,
// without revealing WHICH position in the tree the leaf occupies (the path
// itself is a private input — only the final root is public).
// ---------------------------------------------------------------------------
template MerkleTreeChecker(levels) {
    signal input leaf;
    signal input root;
    signal input pathElements[levels];
    signal input pathIndices[levels]; // 0 = leaf is on the left, 1 = leaf is on the right

    component hashers[levels];
    component mux[levels];

    signal levelHashes[levels + 1];
    levelHashes[0] <== leaf;

    for (var i = 0; i < levels; i++) {
        mux[i] = MultiMux1(2);
        mux[i].c[0][0] <== levelHashes[i];
        mux[i].c[0][1] <== pathElements[i];
        mux[i].c[1][0] <== pathElements[i];
        mux[i].c[1][1] <== levelHashes[i];
        mux[i].s <== pathIndices[i];

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== mux[i].out[0];
        hashers[i].inputs[1] <== mux[i].out[1];
        levelHashes[i + 1] <== hashers[i].out;
    }

    root === levelHashes[levels];
}

// ---------------------------------------------------------------------------
// Withdraw
// ---------------------------------------------------------------------------
// The actual "prove I own a deposit without saying which one" circuit.
//
// PUBLIC inputs (visible on-chain, anyone can see these):
//   - root:           the Merkle root of all deposits in the pool right now
//   - nullifierHash:  a number that marks this specific deposit as "spent",
//                      without revealing which deposit it was
//
// PRIVATE inputs (known only to the person withdrawing, never revealed):
//   - secret:         the original secret chosen at deposit time
//   - pathElements/pathIndices: the Merkle path proving the deposit is in the tree
//
// NOTE — an honest simplification for this v0 educational version: the
// nullifier and the commitment are both derived from the same `secret` using
// domain separation (a second Poseidon input of 0 vs 1). Production systems
// (like Tornado Cash) use two independently-random values instead of
// deriving both from one secret, which is a stronger design. We're keeping
// one secret here to match the v0 contract you already tested, and can
// upgrade this later once the overall flow is proven end to end.
// ---------------------------------------------------------------------------
template Withdraw(levels) {
    signal input root;             // public
    signal input nullifierHash;    // public

    signal input secret;              // private
    signal input pathElements[levels]; // private
    signal input pathIndices[levels];  // private

    component commitmentHasher = Poseidon(2);
    commitmentHasher.inputs[0] <== secret;
    commitmentHasher.inputs[1] <== 0;

    component nullifierHasher = Poseidon(2);
    nullifierHasher.inputs[0] <== secret;
    nullifierHasher.inputs[1] <== 1;

    component tree = MerkleTreeChecker(levels);
    tree.leaf <== commitmentHasher.out;
    tree.root <== root;
    for (var i = 0; i < levels; i++) {
        tree.pathElements[i] <== pathElements[i];
        tree.pathIndices[i] <== pathIndices[i];
    }

    nullifierHash === nullifierHasher.out;
}

// Tree depth 8 = up to 256 deposits in the pool. Small on purpose, for easy
// testing — a production version would use a much deeper tree (20+ levels).
component main {public [root, nullifierHash]} = Withdraw(8);
