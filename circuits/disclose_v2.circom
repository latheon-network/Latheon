pragma circom 2.0.0;

include "latheon_v8.circom";

// ---------------------------------------------------------------------------
// DiscloseV2 — selective disclosure of one V8 deposit (the V8 counterpart of disclose.circom).
// Testnet only, not audited, not yet deployed.
//
// Proves "I know spendKey and viewKey behind this commitment", bound to one auditor's one-time
// code, and nothing else: the auditor learns which deposit it is, not the keys and not the note's
// nullifier, so it cannot recognise the note's withdrawal later. (disclose_link reveals the
// nullifier on purpose, for receipts and reserves; this circuit is the default disclosure.)
//
// Public: commitment, disclosureTag, auditorNonce. Private: spendKey, viewKey.
// No Merkle path: the auditor reads the Deposit event for the commitment in the pool.
// ---------------------------------------------------------------------------
template DiscloseV2() {
    signal input commitment;      // public
    signal input disclosureTag;   // public: Poseidon(TAG_DISC, viewKey, auditorNonce)
    signal input auditorNonce;    // public: the auditor's one-time code

    signal input spendKey;        // private
    signal input viewKey;         // private

    component c = NoteCommitment();
    c.spendKey <== spendKey;
    c.viewKey <== viewKey;
    commitment === c.out;

    component t = DisclosureTag();
    t.viewKey <== viewKey;
    t.auditorNonce <== auditorNonce;
    disclosureTag === t.out;
}

component main {public [commitment, disclosureTag, auditorNonce]} = DiscloseV2();
