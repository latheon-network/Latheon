// SPDX-License-Identifier: MIT
pragma solidity >=0.8.24 <0.9.0;

import "../contracts/LatheonShieldedPoolV4.sol";

/// @dev Kept in its own file, separate from LatheonShieldedPoolV4_test.sol
///      — same reasoning as WithdrawCaller.sol for V3: Remix's test runner
///      auto-deploys every contract in a test file with zero arguments,
///      which breaks on a helper whose constructor needs an address.

/// @notice Lets a test attempt a withdraw() call and observe success/failure
///         via a return value, instead of the whole test function reverting.
contract WithdrawCallerV4 {
    LatheonShieldedPoolV4 pool;
    constructor(address poolAddress) { pool = LatheonShieldedPoolV4(poolAddress); }

    function tryWithdraw(
        uint256[2] memory pA,
        uint256[2][2] memory pB,
        uint256[2] memory pC,
        uint256[2] memory pubSignals,
        address recipient
    ) external returns (bool ok) {
        (ok, ) = address(pool).call(
            abi.encodeWithSignature(
                "withdraw(uint256[2],uint256[2][2],uint256[2],uint256[2],address)",
                pA, pB, pC, pubSignals, recipient
            )
        );
    }
}
