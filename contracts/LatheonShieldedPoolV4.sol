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

/// @title Latheon Shielded Pool — v4, structured selective disclosure
/// @notice Functionally identical to LatheonShieldedPoolV3 on-chain — same
///         Merkle tree logic, same root history, same nullifier tracking.
///         The only thing that changes is what a commitment MEANS at the
///         circuit/client level: instead of commitment = Poseidon(secret, 0),
///         it's now commitment = Poseidon(Poseidon(spendKey, viewKey), 0) —
///         see docs/selective-disclosure-design.md and
///         circuits/withdraw_v2.circom for the full design and the reasoning
///         behind splitting spend authority from disclosure authority.
///
/// @dev This contract does not need to know anything about spendKey or
///      viewKey — deposit() still just takes a single commitment, computed
///      off-chain. All the meaningful change lives in the circuit, not
///      here. That's deliberate: it keeps this contract exactly as
///      auditable and exactly as tested-by-precedent as LatheonShieldedPoolV3.
///
/// @dev Uses the PoseidonT3 library with `public` visibility, deployed as a
///      separate library contract and linked at deploy time — same
///      configuration confirmed to work on LatheonShieldedPoolV3. Do not
///      change this to `internal` (see that contract's docs for why).
///
/// @dev Requires a NEW Groth16Verifier deployed from circuits/withdraw_v2.circom
///      — the verifier for the original withdraw.circom will NOT work here,
///      since the circuit's public/private input structure differs.
contract LatheonShieldedPoolV4 {

    IERC20 public immutable token;
    IGroth16Verifier public immutable verifier;

    uint256 public constant DENOMINATION = 100 * 10 ** 18; // 100 LTH
    uint256 public constant LEVELS = 8;                    // must match circuits/withdraw_v2.circom
    uint256 public constant ROOT_HISTORY_SIZE = 30;

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

    /// @notice Withdraw by presenting a zero-knowledge proof that you know
    ///         (spendKey, viewKey) behind a leaf in the tree, against a
    ///         root the contract itself produced. Identical interface to
    ///         LatheonShieldedPoolV3 — only the proof's internal meaning
    ///         changed, not this function's signature.
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
