pragma circom 2.0.0;

include "latheon_v8.circom";

// ---------------------------------------------------------------------------
// DiscloseLink — "this deposit and this nullifier belong to the same note in this pool",
// bound to one auditor's one-time code (docs/v8-design.md §5). Testnet only, not audited,
// not yet deployed.
//
// Used for a payment receipt (deposit D paid withdrawal W) and for reserves (these notes have no
// Withdrawal event up to block N). The price, stated in §5: an auditor who has the nullifier of an
// unspent note will recognise its withdrawal later. For a plain "this deposit is mine" use
// disclose_v2, which reveals no nullifier.
//
// Public: commitment, nullifierHash, ctx, auditorNonce, disclosureTag. Private: spendKey, viewKey.
// No Merkle path: the auditor checks the Deposit event (commitment) and the Withdrawal event or
// its absence (nullifierHash) in the pool whose context is ctx.
// ---------------------------------------------------------------------------
template DiscloseLink() {
    signal input commitment;      // public
    signal input nullifierHash;   // public
    signal input ctx;             // public: the pool's context, as in withdraw_v6
    signal input auditorNonce;    // public
    signal input disclosureTag;   // public

    signal input spendKey;        // private
    signal input viewKey;         // private

    component c = NoteCommitment();
    c.spendKey <== spendKey;
    c.viewKey <== viewKey;
    commitment === c.out;

    component n = NoteNullifier();
    n.spendKey <== spendKey;
    n.ctx <== ctx;
    nullifierHash === n.out;

    component t = DisclosureTag();
    t.viewKey <== viewKey;
    t.auditorNonce <== auditorNonce;
    disclosureTag === t.out;
}

component main {public [commitment, nullifierHash, ctx, auditorNonce, disclosureTag]} = DiscloseLink();
