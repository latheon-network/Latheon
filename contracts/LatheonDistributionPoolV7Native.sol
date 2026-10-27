// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// V6 router: the same contract as LatheonDistributionPoolNative.sol over LatheonShieldedPoolV7Native pools (withdraw_v5
// circuit, 20-level trees). The only interface change: withdrawMany takes a `relayer`, and each item carries its
// `fee`; both are bound into each note's proof, so the caller can change neither. Testnet only, not audited.

interface IFixedPoolV7Native {
    function token() external view returns (address);
    function DENOMINATION() external view returns (uint256);
    function deposit(uint256 commitment) external payable;
    function withdraw(
        uint256[2] calldata pA,
        uint256[2][2] calldata pB,
        uint256[2] calldata pC,
        uint256 root,
        uint256 nullifierHash,
        address recipient,
        address relayer,
        uint256 fee
    ) external;
}

/// @title Latheon Distribution Pool — native-coin variant (testnet only, not audited)
/// @notice LatheonDistributionPool over LatheonShieldedPoolV7Native pools: deposit() is payable and forwards
///         exactly each note's denomination to its pool. Same canonical greedy split, same limits, same
///         withdrawMany forwarding. No receive(): the router never holds the coin between transactions.
contract LatheonDistributionPoolV7Native {

    uint256 public constant POOL_COUNT = 4;
    uint256 public constant MAX_NOTES = 32;
    uint256 public constant MAX_WITHDRAWALS = 16;

    IFixedPoolV7Native[POOL_COUNT] public pools;
    uint256[POOL_COUNT] public denominations;

    struct Withdrawal {
        uint256 pool;
        uint256[2] pA;
        uint256[2][2] pB;
        uint256[2] pC;
        uint256 root;
        uint256 nullifierHash;
        uint256 fee;           // V7: this note's relayer fee, bound into its proof (0 for none)
    }

    event Distributed(address indexed depositor, uint256 amount, uint256 notes);
    event WithdrawnMany(address indexed recipient, uint256 notes);

    constructor(address[POOL_COUNT] memory poolAddresses) {
        for (uint256 i = 0; i < POOL_COUNT; i++) {
            IFixedPoolV7Native p = IFixedPoolV7Native(poolAddresses[i]);
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

    /// @notice Deposit msg.value as the canonical set of notes; `amount` must equal msg.value (kept in the
    ///         signature so the call reads the same as the ERC-20 router's).
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

    function withdrawMany(Withdrawal[] calldata items, address recipient, address relayer) external {
        require(items.length > 0, "No withdrawals");
        require(items.length <= MAX_WITHDRAWALS, "Too many withdrawals");
        for (uint256 i = 0; i < items.length; i++) {
            Withdrawal calldata w = items[i];
            require(w.pool < POOL_COUNT, "Unknown pool");
            pools[w.pool].withdraw(w.pA, w.pB, w.pC, w.root, w.nullifierHash, recipient, relayer, w.fee);
        }
        emit WithdrawnMany(recipient, items.length);
    }
}
