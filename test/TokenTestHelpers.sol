// SPDX-License-Identifier: MIT
pragma solidity >=0.8.24 <0.9.0;

import "../contracts/LatheonToken.sol";

/// @dev Kept in its own file, separate from LatheonToken_test.sol — see the
///      comment in FaucetClaimer.sol for why this matters to Remix's test
///      runner (auto-deploy of same-file contracts with zero arguments).

/// @notice Simulates an address with no special privileges trying to call
///         the owner-only mint() function.
contract NonOwnerCaller {
    LatheonToken token;
    constructor(address tokenAddress) { token = LatheonToken(tokenAddress); }
    function tryMint(address to, uint256 amount) external returns (bool ok) {
        (ok, ) = address(token).call(abi.encodeWithSignature("mint(address,uint256)", to, amount));
    }
}

/// @notice Simulates an approved spender calling transferFrom.
contract SpenderCaller {
    LatheonToken token;
    constructor(address tokenAddress) { token = LatheonToken(tokenAddress); }
    function trySpend(address from, address to, uint256 amount) external returns (bool ok) {
        (ok, ) = address(token).call(abi.encodeWithSignature("transferFrom(address,address,uint256)", from, to, amount));
    }
}
