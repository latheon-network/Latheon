pragma circom 2.0.0;

include "circomlib/poseidon.circom";
include "circomlib/mux1.circom";

// ---------------------------------------------------------------------------
// MerkleTreeChecker — unchanged from circuits/withdraw.circom
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
// WithdrawV2 — spend/view key split (prototype, see docs/selective-disclosure-design.md)
// ---------------------------------------------------------------------------
// Differs from circuits/withdraw.circom in exactly one way: the commitment
// now binds TWO secrets instead of one. spendKey alone can no longer
// reconstruct the commitment or satisfy this circuit — viewKey is required
// too. This is what makes the separate disclose.circom prototype possible:
// viewKey can be proven-known without spendKey ever being involved.
//
// nullifierHash is deliberately left depending on spendKey ONLY — spending
// authority should never depend on viewKey, which may end up shared (via
// disclosure proofs) more freely than spendKey ever should be.
// ---------------------------------------------------------------------------
template WithdrawV2(levels) {
    signal input root;             // public
    signal input nullifierHash;    // public

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
}

component main {public [root, nullifierHash]} = WithdrawV2(8);

/* INPUT = {
  "root": "18613485987258854687217293355288823845192543664104813608731909565535979373570",
  "nullifierHash": "4668614330419237175685135586994393712784366392195110467204690597997796757740",
  "spendKey": "555111222",
  "viewKey": "888444333",
  "pathElements": [
    "0",
    "14744269619966411208579211824598458697587494354926760081771325075741142829156",
    "7423237065226347324353380772367382631490014989348495481811164164159255474657",
    "11286972368698509976183087595462810875513684078608517520839298933882497716792",
    "3607627140608796879659380071776844901612302623152076817094415224584923813162",
    "19712377064642672829441595136074946683621277828620209496774504837737984048981",
    "20775607673010627194014556968476266066927294572720319469184847051418138353016",
    "3396914609616007258851405644437304192397291162432396347162513310381425243293"
  ],
  "pathIndices": ["0","0","0","0","0","0","0","0"]
} */
