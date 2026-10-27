pragma circom 2.0.0;

include "circomlib/poseidon.circom";
include "circomlib/mux1.circom";

// ---------------------------------------------------------------------------
// MerkleTreeChecker — fixes a critical under-constraint present in withdraw.circom,
// withdraw_v2.circom, withdraw_v3.circom and withdraw_v4.circom.
// ---------------------------------------------------------------------------
// THE BUG (all earlier versions): `pathIndices[i]` was fed straight into
// circomlib's MultiMux1 as the selector `s`. MultiMux1 computes a linear
// interpolation, out = (c1 - c0) * s + c0, and does NOT constrain s to be 0 or 1.
// Nothing else constrained pathIndices either. A non-binary selector therefore
// lets the prover set a mux output to ANY field element, so a Merkle path can be
// forged to the pool's current root (whose two public children are readable from
// filledSubtrees/zeros) for a commitment that was never deposited — i.e. withdraw
// without ever depositing, draining the pool. Confirmed with a transaction-level
// proof of concept on a local chain.
//
// THE FIX: constrain every selector to a single bit. `pathIndices[i] * (1 - pathIndices[i]) === 0`
// is satisfiable only by 0 or 1, so the mux can output only one of its two children
// and the forgery above is impossible. (This is the `s * (1 - s) === 0` check the
// original Tornado Cash DualMux carried and that was lost when this code moved to
// circomlib's plain MultiMux1.) Nothing else changes.
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
        // FIX: pathIndices[i] must be a bit, or the mux below is not a real left/right choice.
        pathIndices[i] * (1 - pathIndices[i]) === 0;

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
// WithdrawV5 — identical to WithdrawV4 (tree depth 20; public inputs root,
// nullifierHash, recipient, relayer, fee; relayer and fee bound into the proof)
// EXCEPT that MerkleTreeChecker now constrains each pathIndices[i] to a bit.
//
// Commitment, nullifier and the spendKey/viewKey split are byte-for-byte those of
// WithdrawV3/V4, so notes keep the same format and disclose.circom is unchanged.
// The *Square lines keep the compiler from dropping public inputs no other
// constraint touches, exactly as in WithdrawV3/V4. The pool enforces fee <= denomination.
// ---------------------------------------------------------------------------
template WithdrawV5(levels) {
    signal input root;             // public
    signal input nullifierHash;    // public
    signal input recipient;        // public — the address paid DENOMINATION - fee
    signal input relayer;          // public — the address paid fee (0 when there is none)
    signal input fee;              // public — the relayer's fee (0 when there is none)

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

component main {public [root, nullifierHash, recipient, relayer, fee]} = WithdrawV5(20);
