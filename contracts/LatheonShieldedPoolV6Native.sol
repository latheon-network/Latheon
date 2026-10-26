// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./PoseidonT3.sol";

interface IGroth16VerifierV4 {
    function verifyProof(
        uint256[2] calldata _pA,
        uint256[2][2] calldata _pB,
        uint256[2] calldata _pC,
        uint256[5] calldata _pubSignals   // [root, nullifierHash, recipient, relayer, fee]
    ) external view returns (bool);
}

/// @title Latheon Shielded Pool — V6, native-coin variant (testnet only, not audited)
/// @notice LatheonShieldedPoolV6 with the chain's native coin instead of an ERC-20, for a chain whose gas token is
///         the coin users hold (no wrapping, no approve). Same circuit (withdraw_v4), verifier, tree (20 levels),
///         root history (100), nullifiers and recipient/relayer/fee binding as V6. Native-coin specifics, as in
///         LatheonShieldedPoolV5Native:
///           - deposit() is payable and requires msg.value == DENOMINATION;
///           - withdraw() pays AFTER the nullifier is recorded (checks-effects-interactions), so a re-entering
///             recipient or relayer finds the note already spent;
///           - if the recipient or the relayer refuses the coin, the whole withdrawal reverts and the note stays
///             unspent;
///           - token() returns address(0) as the marker of the native coin.
contract LatheonShieldedPoolV6Native {

    IGroth16VerifierV4 public immutable verifier;

    uint256 public immutable DENOMINATION;
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

    constructor(address verifierAddress, uint256 denomination) {
        require(denomination > 0, "Denomination must be positive");
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

    /// @notice address(0): this pool holds the native coin.
    function token() external pure returns (address) { return address(0); }

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

    /// @notice Deposit exactly DENOMINATION of the native coin with the commitment computed off-chain.
    function deposit(uint256 commitment) external payable {
        require(msg.value == DENOMINATION, "Wrong amount");
        uint32 leafIndex = _insert(commitment);
        emit Deposit(commitment, leafIndex, block.timestamp);
    }

    /// @notice Withdraw with a proof bound to `recipient`, `relayer` and `fee`; pays DENOMINATION - fee of the
    ///         native coin to `recipient` and `fee` to `relayer`.
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

        nullifierHashes[nullifierHash] = true;   // effect before the transfers: re-entry finds the note spent

        (bool ok, ) = payable(recipient).call{value: DENOMINATION - fee}("");
        require(ok, "Native transfer failed");
        if (fee > 0) {
            (bool okFee, ) = payable(relayer).call{value: fee}("");
            require(okFee, "Fee transfer failed");
        }

        emit Withdrawal(recipient, nullifierHash, relayer, fee, block.timestamp);
    }
}
