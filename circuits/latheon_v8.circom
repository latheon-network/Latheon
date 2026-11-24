pragma circom 2.0.0;

include "circomlib/poseidon.circom";
include "circomlib/mux1.circom";

// ---------------------------------------------------------------------------
// Shared definitions for the V8 circuits (withdraw_v6, disclose_v2, disclose_link).
// Design: docs/v8-design.md. Testnet only, not audited, not yet deployed.
//
// Domain tags: every hash of a note uses a 3-input Poseidon whose first input says
// what the hash is for, so a commitment, a nullifier and an auditor tag can never be
// confused with one another. Each tag is keccak256(<string>) mod p, the BN254 scalar
// field order; the strings are in the comments and the values are checked by
// test/circuits-v8. Tree nodes stay untagged (decision of 8 November 2026,
// docs/v8-design.md §4 draft a and §13 item 4): a leaf is always a tagged commitment,
// and the on-chain tree keeps the standard 2-input Poseidon.
// ---------------------------------------------------------------------------

// keccak256("latheon.v8.commit") mod p
function TAG_COMMIT() { return 6202629899548816675044144398942228363166898864191660399124700080993181830215; }
// keccak256("latheon.v8.null") mod p
function TAG_NULL() { return 20957196009554530184081329352299522125794319055201401211904291792038270422907; }
// keccak256("latheon.v8.disc") mod p
function TAG_DISC() { return 18930036330532154150058508024591538220117178654391149843433004876223393807341; }

// commitment = Poseidon(TAG_COMMIT, spendKey, viewKey). The commitment does not depend on
// the pool or the chain, so the same note format works in every V8 pool.
template NoteCommitment() {
    signal input spendKey;
    signal input viewKey;
    signal output out;
    component h = Poseidon(3);
    h.inputs[0] <== TAG_COMMIT();
    h.inputs[1] <== spendKey;
    h.inputs[2] <== viewKey;
    out <== h.out;
}

// nullifierHash = Poseidon(TAG_NULL, spendKey, ctx), where ctx identifies the chain and the
// pool (computed by the pool contract, docs/v8-design.md §3). The same note therefore has a
// different nullifier in every pool and on every chain.
template NoteNullifier() {
    signal input spendKey;
    signal input ctx;
    signal output out;
    component h = Poseidon(3);
    h.inputs[0] <== TAG_NULL();
    h.inputs[1] <== spendKey;
    h.inputs[2] <== ctx;
    out <== h.out;
}

// disclosureTag = Poseidon(TAG_DISC, viewKey, auditorNonce): binds a disclosure proof to one
// auditor's one-time code without revealing viewKey.
template DisclosureTag() {
    signal input viewKey;
    signal input auditorNonce;
    signal output out;
    component h = Poseidon(3);
    h.inputs[0] <== TAG_DISC();
    h.inputs[1] <== viewKey;
    h.inputs[2] <== auditorNonce;
    out <== h.out;
}

// Merkle membership with standard 2-input Poseidon nodes. Every selector is constrained to a
// bit: without s*(1-s)=0, circomlib's MultiMux1 accepts any field element as a selector and a
// path can be forged (the flaw fixed in withdraw_v5 for V7, THREAT-MODEL.md §8.0).
template MerkleRoot(levels) {
    signal input leaf;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    signal output root;

    component hashers[levels];
    component mux[levels];
    signal levelHashes[levels + 1];
    levelHashes[0] <== leaf;

    for (var i = 0; i < levels; i++) {
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

    root <== levelHashes[levels];
}
