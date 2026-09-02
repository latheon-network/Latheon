pragma circom 2.0.0;

include "circomlib/poseidon.circom";

// ---------------------------------------------------------------------------
// Disclose
// ---------------------------------------------------------------------------
// Proves knowledge of (spendKey, viewKey) behind a publicly-known commitment,
// without revealing either value — and binds the proof to a specific
// auditor's one-time nonce, so it can't be replayed to convince anyone else.
//
// This is deliberately minimal: no Merkle tree membership check. The
// auditor already knows which commitment is in question (it's public
// on-chain via the Deposit event) and can independently confirm it was
// really deposited by checking that event log themselves — this circuit's
// only job is proving "I am the one who knows the secret behind it."
// ---------------------------------------------------------------------------
template Disclose() {
    signal input commitment;      // public — the specific deposit being discussed
    signal input disclosureTag;   // public — Poseidon(viewKey, auditorNonce)
    signal input auditorNonce;    // public — the one-time code the auditor issued

    signal input spendKey;        // private
    signal input viewKey;         // private

    component commitmentHasher = Poseidon(2);
    commitmentHasher.inputs[0] <== spendKey;
    commitmentHasher.inputs[1] <== viewKey;

    // NOTE: this uses a 2-input Poseidon over (spendKey, viewKey) as an
    // intermediate step, then hashes that against a domain-separating 0,
    // mirroring how the existing commitment = Poseidon(secret, 0) pattern
    // works in circuits/withdraw.circom — keeping the same conventions
    // rather than inventing new ones.
    component finalCommitment = Poseidon(2);
    finalCommitment.inputs[0] <== commitmentHasher.out;
    finalCommitment.inputs[1] <== 0;

    commitment === finalCommitment.out;

    component tagHasher = Poseidon(2);
    tagHasher.inputs[0] <== viewKey;
    tagHasher.inputs[1] <== auditorNonce;

    disclosureTag === tagHasher.out;
}

component main {public [commitment, disclosureTag, auditorNonce]} = Disclose();

/* INPUT = {
  "commitment": "11227205058284787079772478111906980801971568929448562655634549943579633504484",
  "disclosureTag": "6025950219392763291308327745288933421496688756743780501210242304471461406681",
  "auditorNonce": "777888999",
  "spendKey": "111222333",
  "viewKey": "444555666"
} */

