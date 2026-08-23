// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./PoseidonT3.sol";

interface IGroth16Verifier {
    function verifyProof(
        uint256[2] calldata _pA,
        uint256[2][2] calldata _pB,
        uint256[2] calldata _pC,
        uint256[2] calldata _pubSignals
    ) external view returns (bool);
}

/// @title Latheon Shielded Pool — v3, fully on-chain Merkle tree
/// @notice The record of deposits is maintained entirely on-chain. Every
///         deposit updates the Merkle tree automatically, in the same
///         transaction, using the same Poseidon hash the zero-knowledge
///         circuit relies on — no trusted operator anywhere in the flow.
///
/// @dev The empty-leaf / empty-subtree convention is: level-0 empty value
///      is 0, and every level above is Poseidon(previous, previous). This
///      is computed once in the constructor, not hardcoded, to avoid any
///      risk of a manually-copied constant being wrong. The tree depth
///      (LEVELS = 8) matches circuits/withdraw.circom exactly — the two
///      must never drift apart, since a mismatched depth would make every
///      proof fail to verify against the real on-chain root.
///
/// @dev Uses the PoseidonT3 library with `public` visibility, deployed as
///      a separate library contract and linked at deploy time — this is
///      the configuration confirmed to work correctly end to end on
///      Sepolia. An `internal` (inlined) variant was tried and abandoned:
///      it pushed the contract close to / over the EIP-170 24576-byte
///      contract size limit and produced unreliable behavior. Keep this
///      as a separately-linked library, not inlined.
contract LatheonShieldedPoolV3 {

    IERC20 public immutable token;
    IGroth16Verifier public immutable verifier;

    uint256 public constant DENOMINATION = 100 * 10 ** 18; // 100 LTH
    uint256 public constant LEVELS = 8;                    // must match the circuit
    uint256 public constant ROOT_HISTORY_SIZE = 30;        // grace window for proofs generated against a slightly older root

    uint256[LEVELS] public filledSubtrees;
    uint256[LEVELS + 1] public zeros;

    uint32 public nextIndex;
    uint32 public currentRootIndex;
    uint256[ROOT_HISTORY_SIZE] public roots;

    mapping(uint256 => bool) public nullifierHashes;

    event Deposit(uint256 indexed commitment, uint32 leafIndex, uint256 timestamp);
    event Withdrawal(address indexed to, uint256 nullifierHash, uint256 timestamp);

    constructor(address tokenAddress, address verifierAddress) {
        token = IERC20(tokenAddress);
        verifier = IGroth16Verifier(verifierAddress);

        // Build the empty-subtree cascade using the real Poseidon
        // implementation, on-chain, at deploy time — not a copied constant.
        uint256 currentZero = 0;
        zeros[0] = currentZero;
        for (uint256 i = 0; i < LEVELS; i++) {
            filledSubtrees[i] = currentZero;
            currentZero = PoseidonT3.hash([currentZero, currentZero]);
            zeros[i + 1] = currentZero;
        }
        roots[0] = currentZero; // root of a completely empty tree
    }

    /// @notice Insert a new leaf (commitment) into the tree and update the
    ///         root — fully automatic, inside the same transaction as the
    ///         deposit, for anyone. No operator action required.
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

    /// @notice Checks whether a root is (or recently was) the real tree
    ///         root. A short history window is kept so a proof generated
    ///         a few deposits ago — realistic, since proving takes a
    ///         moment and other deposits may land first — still verifies.
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
    ///         commitment computed off-chain (Poseidon(secret, 0) —
    ///         see circuits/withdraw.circom). The tree updates in this
    ///         same transaction.
    function deposit(uint256 commitment) external {
        bool success = token.transferFrom(msg.sender, address(this), DENOMINATION);
        require(success, "Token transfer failed");

        uint32 leafIndex = _insert(commitment);
        emit Deposit(commitment, leafIndex, block.timestamp);
    }

    /// @notice Withdraw by presenting a zero-knowledge proof that you know
    ///         a secret tied to a leaf in the tree, against a root the
    ///         contract itself produced.
    function withdraw(
        uint256[2] calldata _pA,
        uint256[2][2] calldata _pB,
        uint256[2] calldata _pC,
        uint256[2] calldata _pubSignals,
        address recipient
    ) external {
        uint256 root = _pubSignals[0];
        uint256 nullifierHash = _pubSignals[1];

        require(isKnownRoot(root), "Unknown root");
        require(!nullifierHashes[nullifierHash], "Note already spent");

        bool validProof = verifier.verifyProof(_pA, _pB, _pC, _pubSignals);
        require(validProof, "Invalid proof");

        nullifierHashes[nullifierHash] = true;

        bool success = token.transfer(recipient, DENOMINATION);
        require(success, "Token transfer failed");

        emit Withdrawal(recipient, nullifierHash, block.timestamp);
    }
}
