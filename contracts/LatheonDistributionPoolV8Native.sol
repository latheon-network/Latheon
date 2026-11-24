// SPDX-License-Identifier: MIT
pragma solidity 0.8.39;

import "./ILatheonV8.sol";

/// @title Latheon Distribution Pool — V8, native coin (testnet only, not audited)
/// @notice The router over four LatheonShieldedPoolV8Native pools (descending denominations, each dividing the one
///         before). Same canonical greedy split, limits and deposit as LatheonDistributionPoolV7Native. Changes:
///           - each withdrawal item carries its own `paymentRef` (bound into its proof with recipient, relayer, fee and
///             this chain's id);
///           - withdrawMany skips a note that is already spent (someone else withdrew it, or the batch names it twice)
///             instead of reverting the whole batch, reports each skipped note in NoteSkipped and returns how many
///             were paid; any other failure (bad proof, unknown root, refused payout) still reverts everything, and a
///             batch in which nothing could be paid reverts ("Nothing to withdraw").
///         No receive(): the router never holds the coin between transactions.
contract LatheonDistributionPoolV8Native {

    uint256 public constant POOL_COUNT = 4;
    uint256 public constant MAX_NOTES = 32;
    uint256 public constant MAX_WITHDRAWALS = 16;

    ILatheonPoolV8Native[POOL_COUNT] public pools;
    uint256[POOL_COUNT] public denominations;

    struct Withdrawal {
        uint256 pool;
        ProofV8 proof;
        uint256 root;
        uint256 nullifierHash;
        uint256 fee;         // this note's relayer fee, bound into its proof (0 for none)
        bytes32 paymentRef;  // this note's payment reference or random bytes, bound into its proof
    }

    event Distributed(address indexed depositor, uint256 amount, uint256 notes);
    event WithdrawnMany(address indexed recipient, uint256 paid, uint256 skipped);
    event NoteSkipped(uint256 indexed pool, uint256 nullifierHash);

    constructor(address[POOL_COUNT] memory poolAddresses) {
        for (uint256 i = 0; i < POOL_COUNT; i++) {
            ILatheonPoolV8Native p = ILatheonPoolV8Native(poolAddresses[i]);
            require(address(p) != address(0), "Zero pool");
            require(p.token() == address(0), "Not a native pool");
            uint256 d = p.DENOMINATION();
            require(d > 0, "Zero denomination");
            if (i > 0) require(denominations[i - 1] > d && denominations[i - 1] % d == 0, "Denominations must be descending and divide each other");
            pools[i] = p;
            denominations[i] = d;
        }
    }

    /// @notice address(0): the router moves the native coin.
    function token() external pure returns (address) { return address(0); }

    function split(uint256 amount) public view returns (uint256[POOL_COUNT] memory counts, uint256 total) {
        require(amount > 0, "Zero amount");
        require(amount % denominations[POOL_COUNT - 1] == 0, "Amount is not a multiple of the smallest denomination");
        uint256 rest = amount;
        for (uint256 i = 0; i < POOL_COUNT; i++) {
            counts[i] = rest / denominations[i];
            rest -= counts[i] * denominations[i];
            total += counts[i];
        }
    }

    /// @notice Deposit msg.value as the canonical set of notes; `amount` must equal msg.value.
    function deposit(uint256 amount, uint256[] calldata commitments) external payable {
        require(msg.value == amount, "msg.value must equal amount");
        (uint256[POOL_COUNT] memory counts, uint256 total) = split(amount);
        require(total <= MAX_NOTES, "Too many notes");
        require(commitments.length == total, "Wrong number of commitments");
        for (uint256 i = 0; i < total; i++) {
            for (uint256 j = i + 1; j < total; j++) {
                require(commitments[i] != commitments[j], "Duplicate commitment");
            }
        }
        uint256 k = 0;
        for (uint256 i = 0; i < POOL_COUNT; i++) {
            uint256 d = denominations[i];
            for (uint256 n = 0; n < counts[i]; n++) {
                pools[i].deposit{value: d}(commitments[k]);
                k++;
            }
        }
        emit Distributed(msg.sender, amount, total);
    }

    /// @notice Withdraw several notes to one recipient in one transaction; skips notes already spent.
    /// @return paid the number of notes paid out.
    function withdrawMany(Withdrawal[] calldata items, address recipient, address relayer) external returns (uint256 paid) {
        require(items.length > 0, "No withdrawals");
        require(items.length <= MAX_WITHDRAWALS, "Too many withdrawals");
        uint256 skipped = 0;
        for (uint256 i = 0; i < items.length; i++) {
            Withdrawal calldata w = items[i];
            require(w.pool < POOL_COUNT, "Unknown pool");
            ILatheonPoolV8Native p = pools[w.pool];
            if (p.nullifierHashes(w.nullifierHash)) {
                skipped++;
                emit NoteSkipped(w.pool, w.nullifierHash);
                continue;
            }
            p.withdraw(w.proof, w.root, w.nullifierHash, ExtDataV8(recipient, relayer, w.fee, w.paymentRef, block.chainid));
            paid++;
        }
        require(paid > 0, "Nothing to withdraw");
        emit WithdrawnMany(recipient, paid, skipped);
    }
}
