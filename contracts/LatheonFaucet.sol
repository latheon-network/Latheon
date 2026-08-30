// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title Latheon Faucet
/// @notice Dispenses a fixed amount of test LTH to any address, rate-limited
///         per address to prevent draining. Purely a testnet convenience —
///         has no connection to the shielded pool's privacy guarantees.
contract LatheonFaucet {

    IERC20 public immutable token;

    uint256 public constant DRIP_AMOUNT = 500 * 10 ** 18; // 500 LTH per claim — enough for 5 deposits into the shielded pool
    uint256 public constant COOLDOWN = 24 hours;

    mapping(address => uint256) public lastClaimed;

    event Claimed(address indexed recipient, uint256 amount, uint256 timestamp);

    constructor(address tokenAddress) {
        token = IERC20(tokenAddress);
    }

    /// @notice Claim DRIP_AMOUNT test LTH. Reverts if called again before
    ///         COOLDOWN has passed, or if the faucet has run dry.
    function claim() external {
        require(block.timestamp >= lastClaimed[msg.sender] + COOLDOWN, "Please wait before claiming again");
        require(token.balanceOf(address(this)) >= DRIP_AMOUNT, "Faucet is empty, please check back later");

        lastClaimed[msg.sender] = block.timestamp;

        bool success = token.transfer(msg.sender, DRIP_AMOUNT);
        require(success, "Token transfer failed");

        emit Claimed(msg.sender, DRIP_AMOUNT, block.timestamp);
    }

    /// @notice Helper for a frontend: seconds remaining before `user` can
    ///         claim again. Returns 0 if they can claim right now.
    function timeUntilNextClaim(address user) external view returns (uint256) {
        uint256 nextClaimTime = lastClaimed[user] + COOLDOWN;
        if (block.timestamp >= nextClaimTime) {
            return 0;
        }
        return nextClaimTime - block.timestamp;
    }

    /// @notice How many claims are left in the faucet at the current balance.
    function claimsRemaining() external view returns (uint256) {
        return token.balanceOf(address(this)) / DRIP_AMOUNT;
    }
}
