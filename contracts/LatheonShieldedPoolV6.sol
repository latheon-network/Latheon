// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./PoseidonT3.sol";

interface IGroth16VerifierV4 {
    function verifyProof(
        uint256[2] calldata _pA,
        uint256[2][2] calldata _pB,
        uint256[2] calldata _pC,
        uint256[5] calldata _pubSignals   // [root, nullifierHash, recipient, relayer, fee]
    ) external view returns (bool);
}

/// @title Latheon Shielded Pool — V6 (testnet only, not audited)
/// @notice V6 = V5 with the withdraw_v4 circuit. Two changes, nothing else:
///
///         1. CAPACITY — the Merkle tree has 20 levels instead of 8: a pool holds up to
///            2^20 = 1,048,576 deposits instead of 256, and keeps the last 100 roots instead
///            of 30, so a proof stays valid while up to 99 more deposits land in the pool.
///            Deposits cost more gas (one Poseidon hash per level).
///
///         2. RELAYER FEE IN THE PROOF — withdraw() takes `relayer` and `fee`, both public
///            inputs of the proof, like `recipient`. The pool pays DENOMINATION - fee to
///            `recipient` and `fee` to `relayer`. Whoever submits the transaction can change
///            none of the three. fee = 0 with relayer = address(0) is a plain withdrawal.
///
///         Notes (commitment, nullifier, spendKey/viewKey) keep the V5 format; the disclosure
///         circuit and DiscloseVerifier are unchanged. Proving keys come from a single-party
///         development setup (docs/dev-ceremony-v4.md): testnets only.
contract LatheonShieldedPoolV6 {

    IERC20 public immutable token;
    IGroth16VerifierV4 public immutable verifier;

    uint256 public immutable DENOMINATION;                 // fixed per deployment, set in constructor
    uint256 public constant LEVELS = 20;                   // must match circuits/withdraw_v4.circom (2^20 = 1,048,576 deposits)
    uint256 public constant ROOT_HISTORY_SIZE = 100;     // a proof stays valid for the next 99 deposits into this pool

    uint256[LEVELS] public filledSubtrees;
    uint256[LEVELS + 1] public zeros;

    uint32 public nextIndex;
    uint32 public currentRootIndex;
    uint256[ROOT_HISTORY_SIZE] public roots;

    mapping(uint256 => bool) public nullifierHashes;

    event Deposit(uint256 indexed commitment, uint32 leafIndex, uint256 timestamp);
    event Withdrawal(address indexed to, uint256 nullifierHash, address indexed relayer, uint256 fee, uint256 timestamp);

    constructor(address tokenAddress, address verifierAddress, uint256 denomination) {
        require(denomination > 0, "Denomination must be positive");
        token = IERC20(tokenAddress);
        verifier = IGroth16VerifierV4(verifierAddress);
        DENOMINATION = denomination;

        uint256 currentZero = 0;
        zeros[0] = currentZero;
        for (uint256 i = 0; i < LEVELS; i++) {
            filledSubtrees[i] = currentZero;
            currentZero = PoseidonT3.hash([currentZero, currentZero]);
            zeros[i + 1] = currentZero;
        }
        roots[0] = currentZero;
    }

    function _insert(uint256 leaf) internal returns (uint32) {
        uint32 idx = nextIndex;
        require(idx < uint32(2 ** LEVELS), "Tree is full");

        uint256 currentIndex = idx;
        uint256 currentHash = leaf;

        for (uint256 i = 0; i < LEVELS; i++) {
            uint256 left;
            uint256 right;
            if (currentIndex % 2 == 0) {
                left = currentHash;
                right = zeros[i];
                filledSubtrees[i] = currentHash;
            } else {
                left = filledSubtrees[i];
                right = currentHash;
            }
            currentHash = PoseidonT3.hash([left, right]);
            currentIndex /= 2;
        }

        currentRootIndex = (currentRootIndex + 1) % uint32(ROOT_HISTORY_SIZE);
        roots[currentRootIndex] = currentHash;
        nextIndex = idx + 1;
        return idx;
    }

    function isKnownRoot(uint256 _root) public view returns (bool) {
        if (_root == 0) return false;
        uint32 i = currentRootIndex;
        for (uint32 c = 0; c < ROOT_HISTORY_SIZE; c++) {
            if (roots[i] == _root) return true;
            if (i == 0) {
                i = uint32(ROOT_HISTORY_SIZE);
            }
            i--;
        }
        return false;
    }

    /// @notice Deposit exactly DENOMINATION tokens, providing the
    ///         commitment computed off-chain as
    ///         Poseidon(Poseidon(spendKey, viewKey), 0) —
    ///         see circuits/withdraw_v2.circom. The tree updates in this
    ///         same transaction.
    function deposit(uint256 commitment) external {
        bool success = token.transferFrom(msg.sender, address(this), DENOMINATION);
        require(success, "Token transfer failed");

        uint32 leafIndex = _insert(commitment);
        emit Deposit(commitment, leafIndex, block.timestamp);
    }

    /// @notice Withdraw with a proof bound to `recipient`, `relayer` and `fee`. Pays DENOMINATION - fee
    ///         to `recipient` and `fee` to `relayer`. All three are public inputs of the proof, built here
    ///         from the call's own arguments, so a proof made for one set of them verifies for no other.
    function withdraw(
        uint256[2] calldata _pA,
        uint256[2][2] calldata _pB,
        uint256[2] calldata _pC,
        uint256 root,
        uint256 nullifierHash,
        address recipient,
        address relayer,
        uint256 fee
    ) external {
        require(recipient != address(0), "Zero recipient");
        require(fee <= DENOMINATION, "Fee exceeds denomination");
        require(fee == 0 || relayer != address(0), "Fee without relayer");
        require(isKnownRoot(root), "Unknown root");
        require(!nullifierHashes[nullifierHash], "Note already spent");

        uint256[5] memory pubSignals = [root, nullifierHash, uint256(uint160(recipient)), uint256(uint160(relayer)), fee];
        require(verifier.verifyProof(_pA, _pB, _pC, pubSignals), "Invalid proof");

        nullifierHashes[nullifierHash] = true;

        require(token.transfer(recipient, DENOMINATION - fee), "Token transfer failed");
        if (fee > 0) require(token.transfer(relayer, fee), "Fee transfer failed");

        emit Withdrawal(recipient, nullifierHash, relayer, fee, block.timestamp);
    }
}
