pragma circom 2.0.0;
include "v8_common.circom";
component main {public [commitment, nullifierHash, ctx, auditorNonce, disclosureTag]} = DiscloseLink();
