// SPDX-License-Identifier: MIT
pragma solidity >=0.8.24 <0.9.0;

import "../contracts/LatheonFaucet.sol";

/// @notice Minimal helper contract: lets a test simulate a second,
///         independent claimer. A call FROM this contract shows up at the
///         faucet with msg.sender = this contract's own address — exactly
///         what's needed to test the per-address cooldown logic.
///
/// @dev Deliberately kept in its own file, separate from any *_test.sol
///      file: Remix's Solidity Unit Testing plugin auto-deploys every
///      contract it finds inside a file it treats as a test file, using a
///      zero-argument constructor call. A helper with a required
///      constructor argument living in the same file as the tests breaks
///      that auto-deploy step ("incorrect number of arguments to
///      constructor") and stalls the whole run. Keeping it here, imported
///      by the test file rather than defined inline, avoids the problem.
contract FaucetClaimer {
    LatheonFaucet public faucet;

    constructor(address faucetAddress) {
        faucet = LatheonFaucet(faucetAddress);
    }

    function doClaim() external returns (bool success) {
        (success, ) = address(faucet).call(abi.encodeWithSignature("claim()"));
    }
}
