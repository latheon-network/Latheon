pragma circom 2.0.0;

include "circomlib/poseidon.circom";
include "circomlib/mux1.circom";

// ---------------------------------------------------------------------------
// MerkleTreeChecker — unchanged from circuits/withdraw.circom and withdraw_v2.circom
// ---------------------------------------------------------------------------
template MerkleTreeChecker(levels) {
    signal input leaf;
    signal input root;
    signal input pathElements[levels];
    signal input pathIndices[levels];

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
// WithdrawV3 — withdraw_v2 + the recipient address bound into the proof
// ---------------------------------------------------------------------------
// WHY THIS EXISTS (security fix): in withdraw_v2 the recipient address was NOT
// part of the zero-knowledge statement — only (root, nullifierHash) were
// public. A valid proof was therefore valid for ANY recipient. Anyone who saw
// a withdrawal transaction before it was included could copy the proof,
// substitute their own address, and receive the funds. We reproduced this
// against the V4 contract (see docs/withdraw-recipient-binding.md).
//
// THE FIX: `recipient` is now a third public input. The contract derives it
// from the address actually being paid, so a proof generated for address A
// verifies only when the pool is paying address A.
//
// `recipientSquare` is an otherwise-unused constraint. Circom/snarkjs may
// optimise away a public input that no constraint touches; squaring it forces
// the compiler to keep it in the circuit (the same technique Tornado Cash uses).
//
// Everything else — the spendKey/viewKey split, the nullifier definition, the
// Merkle logic — is byte-for-byte the same as WithdrawV2.
// ---------------------------------------------------------------------------
template WithdrawV3(levels) {
    signal input root;             // public
    signal input nullifierHash;    // public
    signal input recipient;        // public — NEW: the address that will be paid

    signal input spendKey;             // private
    signal input viewKey;              // private
    signal input pathElements[levels]; // private
    signal input pathIndices[levels];  // private

    component innerHasher = Poseidon(2);
    innerHasher.inputs[0] <== spendKey;
    innerHasher.inputs[1] <== viewKey;

    component commitmentHasher = Poseidon(2);
    commitmentHasher.inputs[0] <== innerHasher.out;
    commitmentHasher.inputs[1] <== 0;

    component nullifierHasher = Poseidon(2);
    nullifierHasher.inputs[0] <== spendKey;
    nullifierHasher.inputs[1] <== 1;

    component tree = MerkleTreeChecker(levels);
    tree.leaf <== commitmentHasher.out;
    tree.root <== root;
    for (var i = 0; i < levels; i++) {
        tree.pathElements[i] <== pathElements[i];
        tree.pathIndices[i] <== pathIndices[i];
    }

    nullifierHash === nullifierHasher.out;

    // Bind the recipient into the proof (see header).
    signal recipientSquare;
    recipientSquare <== recipient * recipient;
}

component main {public [root, nullifierHash, recipient]} = WithdrawV3(8);
