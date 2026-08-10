// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IGroth16Verifier {
    function verifyProof(
        uint256[2] calldata _pA,
        uint256[2][2] calldata _pB,
        uint256[2] calldata _pC,
        uint256[2] calldata _pubSignals
    ) external view returns (bool);
}

/// @title Latheon Shielded Pool — zk-SNARK version
/// @notice Withdrawals now require a real zero-knowledge proof (verified by the
///         Groth16Verifier contract you already deployed and tested) instead of
///         simply revealing a secret. This is the core upgrade over v0.
///
/// @dev HONEST SIMPLIFICATION — read before treating this as final:
///      The Merkle tree of deposits is maintained OFF-chain (by the owner, for
///      now) rather than updated automatically on-chain with every deposit.
///      Building that on-chain requires a Poseidon hash implementation in
///      Solidity — a large, constants-heavy library that needs to be generated
///      by a tool and verified carefully, which is the next phase of work.
///      This version proves the withdrawal privacy mechanism works completely
///      honestly; only the tree bookkeeping is (temporarily) centralized.
contract LatheonShieldedPoolZK is Ownable {

    IERC20 public immutable token;
    IGroth16Verifier public immutable verifier;
    uint256 public constant DENOMINATION = 100 * 10 ** 18; // 100 LTH

    uint256 public root;
    mapping(uint256 => bool) public nullifierHashes;

    event Deposit(address indexed depositor, uint256 timestamp);
    event RootUpdated(uint256 newRoot, uint256 timestamp);
    event Withdrawal(address indexed to, uint256 nullifierHash, uint256 timestamp);

    constructor(address tokenAddress, address verifierAddress, address initialOwner)
        Ownable(initialOwner)
    {
        token = IERC20(tokenAddress);
        verifier = IGroth16Verifier(verifierAddress);
    }

    /// @notice Deposit exactly DENOMINATION tokens into the pool.
    function deposit() external {
        bool success = token.transferFrom(msg.sender, address(this), DENOMINATION);
        require(success, "Token transfer failed");
        emit Deposit(msg.sender, block.timestamp);
    }

    /// @notice Owner publishes the current Merkle root after recomputing it
    ///         off-chain to include all deposits so far.
    function updateRoot(uint256 newRoot) external onlyOwner {
        root = newRoot;
        emit RootUpdated(newRoot, block.timestamp);
    }

    /// @notice Withdraw DENOMINATION tokens by presenting a zk-SNARK proof that
    ///         you know a secret whose commitment is included in the current
    ///         tree — without revealing which deposit it is. `recipient` can be
    ///         any address, decoupled from whoever made the original deposit.
    function withdraw(
        uint256[2] calldata _pA,
        uint256[2][2] calldata _pB,
        uint256[2] calldata _pC,
        uint256[2] calldata _pubSignals,
        address recipient
    ) external {
        require(_pubSignals[0] == root, "Proof does not match current root");

        uint256 nullifierHash = _pubSignals[1];
        require(!nullifierHashes[nullifierHash], "Note already spent");

        bool validProof = verifier.verifyProof(_pA, _pB, _pC, _pubSignals);
        require(validProof, "Invalid proof");

        nullifierHashes[nullifierHash] = true;

        bool success = token.transfer(recipient, DENOMINATION);
        require(success, "Token transfer failed");

        emit Withdrawal(recipient, nullifierHash, block.timestamp);
    }
}
