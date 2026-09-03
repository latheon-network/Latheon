// SPDX-License-Identifier: MIT
pragma solidity >=0.8.24 <0.9.0;

import "remix_tests.sol";
import "../contracts/DiscloseVerifier.sol";

/// @title Disclose Verifier tests — REAL cryptography, not a mock
/// @notice Unlike LatheonShieldedPoolV3_test.sol and
///         LatheonShieldedPoolV4_test.sol, which use MockVerifier to test
///         contract logic in isolation from cryptography, this file tests
///         the actual deployed Groth16Verifier for circuits/disclose.circom
///         (0xd56e6125b2dF850D32F8c3538fF840528c53caf5 on Sepolia) using a
///         real proof that has already been independently confirmed
///         correct via a live on-chain call — see STATUS.md §3.
///
///         This is possible here specifically because we have real,
///         already-verified proof data to hardcode as a known-good vector
///         — that data doesn't exist for arbitrary future proofs, which is
///         exactly why the pool-level tests use a mock instead.
contract DiscloseVerifierTest {

    Groth16Verifier verifier;

    // Real proof, generated for spendKey=555111222 (unrelated test vector
    // reused here only incidentally) — actually for the disclose test
    // vector: spendKey/viewKey pair whose resulting commitment and
    // disclosureTag were independently confirmed TRUE via a live
    // eth_call against the deployed verifier. See STATUS.md §3 and
    // docs/selective-disclosure-design.md.
    uint256[2] validPA = [
        13918305133256401158403201772288003677127353711744318566075405518511271238648,
        5802771343096535448375970173788695287490569655088860343589721567128508666555
    ];
    uint256[2][2] validPB = [
        [
            19647729933306202961004025231164966618659639916230892450742085696541246944340,
            1651154153387310312595064772880943666397584045735490051499387609622155848814
        ],
        [
            1392408777854551853671059091990045741265855021896360303023665047904129771007,
            17192240910907847530813386280069852865416207111697571839292841022960521219730
        ]
    ];
    uint256[2] validPC = [
        20387011945263099673499405532180389749725673930530240379676453535024146972730,
        2701910170808684853870875357451654698770903046564627713564099036590091309287
    ];
    uint256[3] validPubSignals = [
        11227205058284787079772478111906980801971568929448562655634549943579633504484, // commitment
        6025950219392763291308327745288933421496688756743780501210242304471461406681,  // disclosureTag
        777888999                                                                       // auditorNonce
    ];

    function beforeAll() public {
        verifier = new Groth16Verifier();
    }

    /// @notice The real, already-confirmed-on-chain proof must verify true
    ///         here too — this is the same math the live contract runs.
    function checkKnownGoodProofVerifies() public {
        bool result = verifier.verifyProof(validPA, validPB, validPC, validPubSignals);
        Assert.ok(result, "the real, independently-confirmed proof should verify as true");
    }

    /// @notice Tampering with even one value in the proof must cause
    ///         rejection — confirms the verifier actually checks the
    ///         cryptography rather than, say, only checking public inputs.
    function checkTamperedProofRejected() public {
        uint256[2] memory tamperedPA = [validPA[0] + 1, validPA[1]];
        bool result = verifier.verifyProof(tamperedPA, validPB, validPC, validPubSignals);
        Assert.ok(!result, "a proof with a single tampered value should be rejected");
    }

    /// @notice A valid proof presented with the WRONG auditor nonce must be
    ///         rejected — this is the actual security property the whole
    ///         disclosure design depends on: a proof can't be replayed to
    ///         convince a different auditor than the one it was bound to.
    function checkWrongAuditorNonceRejected() public {
        uint256[3] memory wrongNonceSignals = [
            validPubSignals[0],
            validPubSignals[1],
            uint256(111111111) // a different auditor's nonce
        ];
        bool result = verifier.verifyProof(validPA, validPB, validPC, wrongNonceSignals);
        Assert.ok(!result, "a proof bound to one auditor's nonce must not verify against a different nonce");
    }
}
