pragma circom 2.0.0;
include "circomlib/poseidon.circom";
include "circomlib/mux1.circom";
include "circomlib/comparators.circom";
// Domain tags (draft values)
function TAG_COMMIT() { return 1; }
function TAG_NULL() { return 2; }
function TAG_NODE() { return 3; }
function TAG_CTX() { return 4; }
function TAG_DISC() { return 5; }
template Tree(levels, tagged) {
  signal input leaf; signal input pathElements[levels]; signal input pathIndices[levels]; signal output root;
  component h[levels]; component m[levels]; signal lv[levels + 1]; lv[0] <== leaf;
  for (var i = 0; i < levels; i++) {
    pathIndices[i] * (1 - pathIndices[i]) === 0;
    m[i] = MultiMux1(2);
    m[i].c[0][0] <== lv[i]; m[i].c[0][1] <== pathElements[i]; m[i].c[1][0] <== pathElements[i]; m[i].c[1][1] <== lv[i]; m[i].s <== pathIndices[i];
    if (tagged == 1) { h[i] = Poseidon(3); h[i].inputs[0] <== TAG_NODE(); h[i].inputs[1] <== m[i].out[0]; h[i].inputs[2] <== m[i].out[1]; }
    else { h[i] = Poseidon(2); h[i].inputs[0] <== m[i].out[0]; h[i].inputs[1] <== m[i].out[1]; }
    lv[i + 1] <== h[i].out;
  }
  root <== lv[levels];
}
template WithdrawV6(levels, taggedTree, asp) {
  signal input root; signal input nullifierHash; signal input ctx; signal input extDataHash; signal input aspRoot;
  signal input spendKey; signal input viewKey;
  signal input pathElements[levels]; signal input pathIndices[levels];
  signal input aspPathElements[levels]; signal input aspPathIndices[levels];
  component c = Poseidon(3); c.inputs[0] <== TAG_COMMIT(); c.inputs[1] <== spendKey; c.inputs[2] <== viewKey;
  component n = Poseidon(3); n.inputs[0] <== TAG_NULL(); n.inputs[1] <== spendKey; n.inputs[2] <== ctx;
  nullifierHash === n.out;
  component t = Tree(levels, taggedTree); t.leaf <== c.out;
  for (var i = 0; i < levels; i++) { t.pathElements[i] <== pathElements[i]; t.pathIndices[i] <== pathIndices[i]; }
  root === t.root;
  if (asp == 1) {
    component a = Tree(levels, taggedTree); a.leaf <== c.out;
    for (var i = 0; i < levels; i++) { a.pathElements[i] <== aspPathElements[i]; a.pathIndices[i] <== aspPathIndices[i]; }
    component z = IsZero(); z.in <== aspRoot;
    (a.root - aspRoot) * (1 - z.out) === 0;   // aspRoot = 0: no association set
  } else {
    signal aspSq; aspSq <== aspRoot * aspRoot;
    for (var i = 0; i < levels; i++) { aspPathElements[i] * 0 === 0; aspPathIndices[i] * 0 === 0; }
  }
  signal ctxSq; ctxSq <== ctx * ctx;
  signal extSq; extSq <== extDataHash * extDataHash;
}
template DiscloseLink() {
  signal input commitment; signal input nullifierHash; signal input ctx; signal input auditorNonce; signal input disclosureTag;
  signal input spendKey; signal input viewKey;
  component c = Poseidon(3); c.inputs[0] <== TAG_COMMIT(); c.inputs[1] <== spendKey; c.inputs[2] <== viewKey; commitment === c.out;
  component n = Poseidon(3); n.inputs[0] <== TAG_NULL(); n.inputs[1] <== spendKey; n.inputs[2] <== ctx; nullifierHash === n.out;
  component d = Poseidon(3); d.inputs[0] <== TAG_DISC(); d.inputs[1] <== viewKey; d.inputs[2] <== auditorNonce; disclosureTag === d.out;
}
