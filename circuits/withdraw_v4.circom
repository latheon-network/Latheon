pragma circom 2.0.0;

include "circomlib/poseidon.circom";
include "circomlib/mux1.circom";

// ---------------------------------------------------------------------------
// MerkleTreeChecker — unchanged from circuits/withdraw.circom, withdraw_v2.circom and withdraw_v3.circom
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
// WithdrawV4 — withdraw_v3 with a deeper tree and the relayer fee bound into the proof
// ---------------------------------------------------------------------------
// What changed from WithdrawV3, and nothing else:
//
// 1. Tree depth 20 instead of 8. A V5 pool holds at most 2^8 = 256 deposits; a pool built
//    for this circuit holds 2^20 = 1,048,576. Splitting deposits over several pools of the
//    same size would shrink each withdrawal's anonymity set, so the pool itself grows.
//
// 2. Two more public inputs: `relayer` (the address paid the fee) and `fee` (the amount it
//    is paid, in the pool's units). The pool pays `fee` to `relayer` and the rest to
//    `recipient`. Because both are in the proof, whoever submits the withdrawal can change
//    neither the recipient nor who gets the fee, nor its size. A user who sends the
//    withdrawal from their own wallet proves with relayer = 0 and fee = 0.
//
// The squares below are otherwise-unused constraints that keep the compiler from dropping
// public inputs no other constraint touches (the technique WithdrawV3 uses for `recipient`).
// The pool, not the circuit, enforces fee <= denomination.
//
// Commitment, nullifier and the spendKey/viewKey split are byte-for-byte those of WithdrawV3,
// so notes keep the same format and the disclosure circuit (disclose.circom) is unchanged.
// ---------------------------------------------------------------------------
template WithdrawV4(levels) {
    signal input root;             // public
    signal input nullifierHash;    // public
    signal input recipient;        // public — the address paid DENOMINATION - fee
    signal input relayer;          // public — NEW: the address paid fee (0 when there is none)
    signal input fee;              // public — NEW: the relayer's fee (0 when there is none)

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

    signal recipientSquare;
    recipientSquare <== recipient * recipient;
    signal relayerSquare;
    relayerSquare <== relayer * relayer;
    signal feeSquare;
    feeSquare <== fee * fee;
}

component main {public [root, nullifierHash, recipient, relayer, fee]} = WithdrawV4(20);
