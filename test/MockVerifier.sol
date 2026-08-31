// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Mock Groth16 Verifier — TEST ONLY, never deploy to a real network
/// @notice Real zero-knowledge proofs can't be constructed inside a Solidity
///         unit test (proof generation happens off-chain, in JS/circom
///         tooling). To test LatheonShieldedPoolV3's own logic — event
///         emission, root checking, nullifier tracking, token transfers —
///         in isolation from the cryptography, we swap in this mock, whose
///         answer is controlled directly by the test rather than computed.
///         This is standard practice, not a shortcut around real testing:
///         the real Groth16Verifier is tested separately, by the actual
///         on-chain proof we already generated and verified (see
///         docs/testnet.md / STATUS.md for that end-to-end confirmation).
contract MockVerifier {
    bool public nextResult = true;

    /// @notice Test helper: control what the next verifyProof() call returns.
    function setNextResult(bool result) external {
        nextResult = result;
    }

    function verifyProof(
        uint256[2] calldata,
        uint256[2][2] calldata,
        uint256[2] calldata,
        uint256[2] calldata
    ) external view returns (bool) {
        return nextResult;
    }
}
