// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title Latheon Shielded Pool (v0)
/// @notice A fixed-denomination pool that hides the link between a deposit and
///         a withdrawal — the first working step toward "private by default,
///         verifiable on demand."
///
/// @dev IMPORTANT — read this before treating this as production-ready:
///      This v0 hides *who withdraws which deposit* only as well as the size
///      of the anonymity set (how many other deposits exist in the pool at
///      the same time). It does NOT use zero-knowledge proofs yet, so a very
///      determined observer watching transaction timing could make educated
///      guesses with enough data. Real production-grade unlinkability needs
///      zk-SNARK withdrawal proofs — that's a later phase, on purpose. This
///      contract is step one: prove the commitment/reveal pattern works.
contract LatheonShieldedPool {

    IERC20 public immutable token;

    // Every deposit must be exactly this amount. Fixed denominations are what
    // make deposits indistinguishable from each other — if amounts varied,
    // the amount itself would leak information about which withdrawal
    // matches which deposit.
    uint256 public constant DENOMINATION = 100 * 10 ** 18; // 100 LTH

    // commitment => still in the pool (true) or already withdrawn (false/never existed)
    mapping(bytes32 => bool) public commitments;

    event Deposit(bytes32 indexed commitment, uint256 timestamp);
    event Withdrawal(address indexed to, bytes32 indexed commitment, uint256 timestamp);

    constructor(address tokenAddress) {
        token = IERC20(tokenAddress);
    }

    /// @notice Helper so you can compute a commitment hash directly in Remix,
    ///         without needing any external tools.
    /// @param secret Any random bytes32 value you pick — this is your private
    ///        "proof of deposit." Keep it safe; whoever has it can withdraw.
    function computeCommitment(bytes32 secret) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(secret));
    }

    /// @notice Deposit exactly DENOMINATION tokens into the pool.
    /// @dev You must call `approve` on the LatheonToken contract first,
    ///      giving this contract permission to move DENOMINATION tokens
    ///      from your account. Standard ERC20 pattern — Remix instructions
    ///      below walk through this.
    function deposit(bytes32 commitment) external {
        require(!commitments[commitment], "Commitment already used");
        commitments[commitment] = true;

        bool success = token.transferFrom(msg.sender, address(this), DENOMINATION);
        require(success, "Token transfer failed");

        emit Deposit(commitment, block.timestamp);
    }

    /// @notice Withdraw DENOMINATION tokens by revealing the secret behind a
    ///         commitment. The recipient can be any address — it does not
    ///         have to be the address that made the original deposit.
    function withdraw(bytes32 secret, address recipient) external {
        bytes32 commitment = computeCommitment(secret);
        require(commitments[commitment], "Invalid or already-withdrawn commitment");

        commitments[commitment] = false;

        bool success = token.transfer(recipient, DENOMINATION);
        require(success, "Token transfer failed");

        emit Withdrawal(recipient, commitment, block.timestamp);
    }
}
