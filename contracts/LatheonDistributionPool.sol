// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev The part of LatheonShieldedPoolV5 that this contract uses. The pools are NOT modified.
interface IFixedPoolV5 {
    function token() external view returns (IERC20);
    function DENOMINATION() external view returns (uint256);
    function deposit(uint256 commitment) external;
    function withdraw(
        uint256[2] calldata pA,
        uint256[2][2] calldata pB,
        uint256[2] calldata pC,
        uint256 root,
        uint256 nullifierHash,
        address recipient
    ) external;
}

/// @title Latheon Distribution Pool (design v0.3, section 2 and decision D1)
/// @notice Accepts an arbitrary amount and spreads it over the already deployed fixed-denomination V5 pools
///         (for example 100 / 50 / 10 / 1) using ONE fixed rule: the canonical greedy split. The caller supplies
///         one commitment per resulting note, each computed off-chain exactly as for a normal V5 deposit.
///
/// @dev What this contract is, and is not
///      - It is a router, not a pool. It holds no balance between transactions and has no storage that
///        changes after construction: no owner, no admin, no fee, no upgrade path, no pause.
///      - It adds no circuit and no trusted setup. Every note it creates is an ordinary V5 note and is withdrawn
///        through the ordinary `withdraw()` of the pool it landed in. "Withdraw part of a deposit" is just
///        withdrawing some of the notes; the others stay available. `withdrawMany` is a convenience that sends
///        several of those ordinary withdrawals in one transaction; it adds no rights and holds nothing.
///      - The split is deterministic and public. A random split was evaluated and rejected (design v0.3,
///        section 3, finding 2): a unique pattern is a fingerprint, a canonical one is shared by everybody who
///        deposits the same amount. The composition of a deposit is therefore VISIBLE on-chain, and the total
///        amount is public. Rounding the amount in the wallet (decision D3) and withdrawing in parts
///        (decision D2) are what actually reduce linkability; this contract does not claim to.
///      - Atomic: if any pool rejects a note (for instance because its tree is full), the whole call reverts.
contract LatheonDistributionPool {

    uint256 public constant POOL_COUNT = 4;

    /// @notice Upper bound on notes per call. It bounds the gas of one transaction; a larger amount is made of
    ///         several calls. See test/distribution for the measured gas per note.
    uint256 public constant MAX_NOTES = 32;

    IERC20 public immutable token;

    /// @dev Set once in the constructor and never written again. Order: largest denomination first.
    IFixedPoolV5[POOL_COUNT] public pools;
    uint256[POOL_COUNT] public denominations;

    /// @notice Upper bound on withdrawals per `withdrawMany` call (about 276k gas each on the V5 pools).
    uint256 public constant MAX_WITHDRAWALS = 16;

    /// @dev One note to take out: the index of its pool (0 = largest denomination) and its ordinary V5 proof.
    struct Withdrawal {
        uint256 pool;
        uint256[2] pA;
        uint256[2][2] pB;
        uint256[2] pC;
        uint256 root;
        uint256 nullifierHash;
    }

    event Distributed(address indexed depositor, uint256 amount, uint256 notes);
    event WithdrawnMany(address indexed recipient, uint256 notes);

    /// @param tokenAddress  The token all four pools hold.
    /// @param poolAddresses The fixed pools, largest denomination first, e.g. [100, 50, 10, 1].
    constructor(address tokenAddress, address[POOL_COUNT] memory poolAddresses) {
        token = IERC20(tokenAddress);
        for (uint256 i = 0; i < POOL_COUNT; i++) {
            IFixedPoolV5 p = IFixedPoolV5(poolAddresses[i]);
            require(address(p) != address(0), "Zero pool");
            require(address(p.token()) == tokenAddress, "Pool token mismatch");
            uint256 d = p.DENOMINATION();
            require(d > 0, "Zero denomination");
            // Each denomination must divide the previous one: that is what makes the greedy split exact and
            // canonical (no amount that is a multiple of the smallest denomination is left over).
            if (i > 0) require(denominations[i - 1] > d && denominations[i - 1] % d == 0, "Denominations must be descending and divide each other");
            pools[i] = p;
            denominations[i] = d;
        }
    }

    /// @notice The canonical split of `amount`: how many notes go to each pool.
    /// @dev Greedy from the largest denomination. Reverts unless `amount` is a positive multiple of the
    ///      smallest denomination.
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

    /// @notice Deposit `amount` as the canonical set of notes. `commitments` holds one commitment per note,
    ///         grouped by pool in the order of `split(amount)` (all notes for the largest pool first).
    ///         The caller must have approved this contract for `amount` of the token.
    function deposit(uint256 amount, uint256[] calldata commitments) external {
        (uint256[POOL_COUNT] memory counts, uint256 total) = split(amount);
        require(total <= MAX_NOTES, "Too many notes");
        require(commitments.length == total, "Wrong number of commitments");

        // Two equal commitments would make the second note unspendable (same nullifier): refuse it up front.
        for (uint256 i = 0; i < total; i++) {
            for (uint256 j = i + 1; j < total; j++) {
                require(commitments[i] != commitments[j], "Duplicate commitment");
            }
        }

        require(token.transferFrom(msg.sender, address(this), amount), "Token transfer failed");

        uint256 k = 0;
        for (uint256 i = 0; i < POOL_COUNT; i++) {
            if (counts[i] == 0) continue;
            // Exactly what this pool will pull, so the allowance is back to zero when the loop ends.
            require(token.approve(address(pools[i]), counts[i] * denominations[i]), "Approve failed");
            for (uint256 n = 0; n < counts[i]; n++) {
                pools[i].deposit(commitments[k]);
                k++;
            }
        }

        emit Distributed(msg.sender, amount, total);
    }

    /// @notice Take several notes out of the pools in ONE transaction, all to `recipient`.
    /// @dev Pure forwarding. Each item is an ordinary V5 `withdraw()` call; the pool verifies the proof, which is
    ///      bound to `recipient`, and pays `recipient` directly. This contract never holds tokens, so a wrong or
    ///      malicious caller can only ever pay the address its proofs were made for. Atomic: if any note is
    ///      refused (already spent, unknown root, invalid proof) the whole call reverts and nothing is withdrawn.
    ///      Withdrawing many notes to one address in one transaction links them to each other and to that
    ///      address; for privacy withdraw notes separately, at different times, to different addresses.
    function withdrawMany(Withdrawal[] calldata items, address recipient) external {
        require(items.length > 0, "No withdrawals");
        require(items.length <= MAX_WITHDRAWALS, "Too many withdrawals");
        for (uint256 i = 0; i < items.length; i++) {
            Withdrawal calldata w = items[i];
            require(w.pool < POOL_COUNT, "Unknown pool");
            pools[w.pool].withdraw(w.pA, w.pB, w.pC, w.root, w.nullifierHash, recipient);
        }
        emit WithdrawnMany(recipient, items.length);
    }
}
