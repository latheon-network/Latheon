// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// This imports a battle-tested, audited token implementation from OpenZeppelin —
// the most widely used smart contract library in the entire Ethereum ecosystem.
// We are NOT reinventing this wheel: token transfer logic is exactly the kind of
// code where using proven building blocks matters more than writing it yourself.
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title Latheon Token (LTH)
/// @notice The native utility token of the Latheon network.
/// @dev This is intentionally simple — a standard ERC20 token — because this is
///      step one: proving the basic building block works before we add any
///      privacy features on top of it in later contracts.
contract LatheonToken is ERC20, Ownable {

    // 100 million tokens, minted once at deployment, to the deployer's address.
    // 18 decimals is the ERC20 standard (same as ETH) — 1 LTH = 1_000_000_000_000_000_000 base units.
    uint256 public constant INITIAL_SUPPLY = 100_000_000 * 10 ** 18;

    constructor(address initialOwner)
        ERC20("Latheon", "LTH")
        Ownable(initialOwner)
    {
        _mint(initialOwner, INITIAL_SUPPLY);
    }

    /// @notice Allows the contract owner to mint additional tokens later
    ///         (for example, for the Genesis Cohort grants pool).
    /// @dev Restricted to the owner only — in a later, more decentralized version
    ///      of this contract, minting rights would move to a governance vote
    ///      instead of a single address. This is a deliberate simplification
    ///      for the first working version, not the final design.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
