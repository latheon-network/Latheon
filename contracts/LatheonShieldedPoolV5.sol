// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./PoseidonT3.sol";

interface IGroth16VerifierV3 {
    function verifyProof(
        uint256[2] calldata _pA,
        uint256[2][2] calldata _pB,
        uint256[2] calldata _pC,
        uint256[3] calldata _pubSignals   // [root, nullifierHash, recipient]
    ) external view returns (bool);
}

/// @title Latheon Shielded Pool — V5
/// @notice V5 = V4 + two changes, nothing else:
///
///         1. SECURITY FIX — the recipient is bound into the proof.
///            In V3/V4 the recipient address was a free parameter of
///            withdraw() that the zero-knowledge proof did not cover, so
///            anyone who saw a pending withdrawal could replay the same
///            proof with their own address and take the funds. In V5 the
///            circuit (circuits/withdraw_v3.circom) takes `recipient` as a
///            public input, and this contract builds that input from the
///            address it is actually about to pay. A proof made for address A
///            can only ever pay address A. See docs/withdraw-recipient-binding.md.
///
///         2. DENOMINATION is an immutable constructor argument instead of a
///            hard-coded constant, so one audited source deploys as a
///            100 / 50 / 10 / 1 pool for any token (and any token decimals)
///            without per-token forks.
///
///         The spendKey/viewKey structure, Merkle tree, root history and
///         nullifier logic are unchanged from V4.
///
/// @dev ABI note: withdraw() no longer takes a `_pubSignals` array. It takes
///      `root` and `nullifierHash` explicitly plus `recipient`, and assembles
///      [root, nullifierHash, recipient] itself — callers cannot supply a
///      recipient signal that differs from the address being paid.
///
/// ---- Inherited V4 documentation ----
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
/// @dev Requires a Groth16Verifier generated from circuits/withdraw_v3.circom
///      (3 public inputs). Verifiers for withdraw.circom / withdraw_v2.circom
///      will NOT work here — their public-input structure differs.
contract LatheonShieldedPoolV5 {

    IERC20 public immutable token;
    IGroth16VerifierV3 public immutable verifier;

    uint256 public immutable DENOMINATION;                 // fixed per deployment, set in constructor
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

    constructor(address tokenAddress, address verifierAddress, uint256 denomination) {
        require(denomination > 0, "Denomination must be positive");
        token = IERC20(tokenAddress);
        verifier = IGroth16VerifierV3(verifierAddress);
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

    /// @notice Withdraw by presenting a zero-knowledge proof that you know
    ///         (spendKey, viewKey) behind a leaf in the tree, against a root
    ///         the contract itself produced, FOR THIS SPECIFIC recipient.
    ///         The proof is bound to `recipient`: it will not verify if the
    ///         pool is asked to pay any other address.
    function withdraw(
        uint256[2] calldata _pA,
        uint256[2][2] calldata _pB,
        uint256[2] calldata _pC,
        uint256 root,
        uint256 nullifierHash,
        address recipient
    ) external {
        require(recipient != address(0), "Zero recipient");
        require(isKnownRoot(root), "Unknown root");
        require(!nullifierHashes[nullifierHash], "Note already spent");

        // The third public signal is derived HERE from the address being paid,
        // never accepted from the caller — this is what closes the replay hole.
        uint256[3] memory pubSignals = [root, nullifierHash, uint256(uint160(recipient))];
        bool validProof = verifier.verifyProof(_pA, _pB, _pC, pubSignals);
        require(validProof, "Invalid proof");

        nullifierHashes[nullifierHash] = true;

        bool success = token.transfer(recipient, DENOMINATION);
        require(success, "Token transfer failed");

        emit Withdrawal(recipient, nullifierHash, block.timestamp);
    }
}
