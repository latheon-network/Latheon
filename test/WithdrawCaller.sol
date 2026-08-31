// SPDX-License-Identifier: MIT
pragma solidity >=0.8.24 <0.9.0;

import "../contracts/LatheonShieldedPoolV3.sol";

/// @dev Kept in its own file, separate from LatheonShieldedPoolV3_test.sol
///      — see the comment in FaucetClaimer.sol for why.

/// @notice Lets a test attempt a withdraw() call and observe success/failure
///         via a return value, instead of the whole test function reverting.
contract WithdrawCaller {
    LatheonShieldedPoolV3 pool;
    constructor(address poolAddress) { pool = LatheonShieldedPoolV3(poolAddress); }

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
