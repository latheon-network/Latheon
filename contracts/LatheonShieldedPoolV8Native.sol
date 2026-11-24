// SPDX-License-Identifier: MIT
pragma solidity 0.8.39;

import "./PoseidonT3.sol";
import "./ILatheonV8.sol";

/// @title Latheon Shielded Pool — V8, native coin (testnet only, not audited)
/// @notice A fixed-denomination pool for the chain's native coin with the withdraw_v6 circuit (docs/v8-design.md).
///         Changes from LatheonShieldedPoolV7Native:
///           - the proof's public inputs are [root, nullifierHash, ctx, extDataHash]; the pool computes ctx (this chain
///             and this pool) and extDataHash (recipient, relayer, fee, paymentRef, destChainId) itself from the call,
///             so a proof is refused by every other pool and chain and pays only what it was made for;
///           - destChainId must be this chain;
///           - deposit() refuses a commitment outside 0 < c < p;
///           - root history: every root this pool ever had stays known for the life of the pool (one lookup), so a
///             proof made now and sent later never goes stale (V7: only the last 100 roots, walked on every withdrawal);
///           - payouts use a limited amount of gas (payoutGas, 100,000 at deployment) and copy no return data, so a
///             contract recipient cannot make a withdrawal expensive;
///           - `guardian`, meant to be a timelocked multisig (§8, decided for the test chain), can pause deposits
///             (never withdrawals) and can raise payoutGas (never lower it, at most MAX_PAYOUT_GAS), so it can never
///             block a withdrawal. guardian = address(0) means neither can ever happen.
///         Unchanged: 20-level Poseidon tree, nullifier recorded before any transfer, a recipient that refuses the coin
///         makes the whole withdrawal revert and the note stays unspent, no receive().
contract LatheonShieldedPoolV8Native {

    uint256 internal constant P = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

    IWithdrawVerifierV6 public immutable verifier;
    uint256 public immutable DENOMINATION;
    address public immutable guardian;

    uint256 public constant LEVELS = 20;                  // circuits/withdraw_v6.circom: 2^20 = 1,048,576 deposits
    uint256 public constant INITIAL_PAYOUT_GAS = 100_000; // gas given to each payout call at deployment
    uint256 public constant MAX_PAYOUT_GAS = 1_000_000;   // the guardian can raise payoutGas up to this, never lower it

    uint256[LEVELS] public filledSubtrees;
    uint256[LEVELS + 1] public zeros;

    uint32 public nextIndex;
    uint256 public currentRoot;
    mapping(uint256 => bool) public knownRoots;   // every root this pool has ever had, kept for its whole life

    mapping(uint256 => bool) public nullifierHashes;
    bool public depositsPaused;
    uint256 public payoutGas = INITIAL_PAYOUT_GAS;

    event Deposit(uint256 indexed commitment, uint32 leafIndex, uint256 timestamp);
    event Withdrawal(address indexed to, uint256 nullifierHash, address indexed relayer, uint256 fee, bytes32 paymentRef, uint256 timestamp);
    event DepositsPaused(bool paused);
    event PayoutGasRaised(uint256 payoutGas);

    constructor(address verifierAddress, uint256 denomination, address guardian_) {
        require(verifierAddress != address(0), "Zero verifier");
        require(denomination > 0, "Denomination must be positive");
        verifier = IWithdrawVerifierV6(verifierAddress);
        DENOMINATION = denomination;
        guardian = guardian_;

        uint256 currentZero = 0;
        zeros[0] = currentZero;
        for (uint256 i = 0; i < LEVELS; i++) {
            filledSubtrees[i] = currentZero;
            currentZero = PoseidonT3.hash([currentZero, currentZero]);
            zeros[i + 1] = currentZero;
        }
        _recordRoot(currentZero);
    }

    /// @notice address(0): this pool holds the native coin.
    function token() external pure returns (address) { return address(0); }

    /// @notice This pool's context: keccak256(abi.encode("latheon.v8.ctx", block.chainid, address(this))) mod p.
    ///         Computed on every call (not stored), so it follows the chain id the pool actually runs on.
    function ctx() public view returns (uint256) {
        return uint256(keccak256(abi.encode("latheon.v8.ctx", block.chainid, address(this)))) % P;
    }

    /// @notice keccak256(abi.encode(recipient, relayer, fee, paymentRef, destChainId)) mod p.
    function extDataHash(ExtDataV8 calldata ext) public pure returns (uint256) {
        return uint256(keccak256(abi.encode(ext.recipient, ext.relayer, ext.fee, ext.paymentRef, ext.destChainId))) % P;
    }

    function _recordRoot(uint256 root) internal {
        currentRoot = root;
        knownRoots[root] = true;
    }

    /// @notice True if `root` was ever a root of this pool. An old root only proves membership in the tree as it was
    ///         then; the nullifier still stops a second withdrawal of the same note.
    function isKnownRoot(uint256 root) public view returns (bool) {
        return root != 0 && knownRoots[root];
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
        _recordRoot(currentHash);
        nextIndex = idx + 1;
        return idx;
    }

    /// @notice Pause or resume deposits. Withdrawals are never paused.
    function setDepositsPaused(bool paused) external {
        require(msg.sender == guardian && guardian != address(0), "Not the guardian");
        depositsPaused = paused;
        emit DepositsPaused(paused);
    }

    /// @notice Raise the gas given to each payout (for contract recipients that need more). Only up, never down,
    ///         at most MAX_PAYOUT_GAS, so it cannot be used to make withdrawals fail.
    function raisePayoutGas(uint256 newPayoutGas) external {
        require(msg.sender == guardian && guardian != address(0), "Not the guardian");
        require(newPayoutGas > payoutGas && newPayoutGas <= MAX_PAYOUT_GAS, "Payout gas can only go up, to at most 1,000,000");
        payoutGas = newPayoutGas;
        emit PayoutGasRaised(newPayoutGas);
    }

    /// @notice Deposit exactly DENOMINATION of the native coin with a commitment computed off-chain
    ///         (Poseidon(TAG_COMMIT, spendKey, viewKey), circuits/latheon_v8.circom).
    function deposit(uint256 commitment) external payable {
        require(!depositsPaused, "Deposits paused");
        require(msg.value == DENOMINATION, "Wrong amount");
        require(commitment != 0 && commitment < P, "Commitment out of range");
        uint32 leafIndex = _insert(commitment);
        emit Deposit(commitment, leafIndex, block.timestamp);
    }

    /// @notice Withdraw one note. Pays DENOMINATION - fee to ext.recipient and fee to ext.relayer.
    function withdraw(ProofV8 calldata proof, uint256 root, uint256 nullifierHash, ExtDataV8 calldata ext) external {
        require(ext.recipient != address(0), "Zero recipient");
        require(ext.fee <= DENOMINATION, "Fee exceeds denomination");
        require(ext.fee == 0 || ext.relayer != address(0), "Fee without relayer");
        require(ext.destChainId == block.chainid, "Wrong destination chain");
        require(isKnownRoot(root), "Unknown root");
        require(!nullifierHashes[nullifierHash], "Note already spent");

        uint256[4] memory pub = [root, nullifierHash, ctx(), extDataHash(ext)];
        require(verifier.verifyProof(proof.pA, proof.pB, proof.pC, pub), "Invalid proof");

        nullifierHashes[nullifierHash] = true;   // effect before the transfers: re-entry finds the note spent

        require(_pay(ext.recipient, DENOMINATION - ext.fee), "Native transfer failed");
        if (ext.fee > 0) require(_pay(ext.relayer, ext.fee), "Fee transfer failed");

        emit Withdrawal(ext.recipient, nullifierHash, ext.relayer, ext.fee, ext.paymentRef, block.timestamp);
    }

    /// @dev A call with at most payoutGas gas that copies no return data.
    function _pay(address to, uint256 amount) internal returns (bool ok) {
        uint256 g = payoutGas;
        assembly {
            ok := call(g, to, amount, 0, 0, 0, 0)
        }
    }
}
