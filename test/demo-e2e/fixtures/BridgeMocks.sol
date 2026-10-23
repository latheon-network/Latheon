// SPDX-License-Identifier: MIT
// Stand-ins for the Arbitrum Orbit bridge contracts, for the bridge page's browser test (bridge-e2e.js) only.
// They keep the real function signatures and events the page uses; the outbox checks the claim's fields against what
// the test recorded instead of a Merkle proof. Not for deployment anywhere.
pragma solidity ^0.8.20;

interface IERC20Min {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

contract MockERC20Inbox {
    address public immutable token;
    event Deposited(address indexed from, uint256 amount);
    constructor(address t) { token = t; }
    function depositERC20(uint256 amount) external returns (uint256) {
        require(IERC20Min(token).transferFrom(msg.sender, address(this), amount), "transferFrom");
        emit Deposited(msg.sender, amount);
        return 0;
    }
}

contract MockRollup {
    address public outbox;
    constructor(address o) { outbox = o; }
}

contract MockOutbox {
    address public immutable token;
    mapping(uint256 => bool) public spent;
    mapping(uint256 => bool) public confirmedSize;
    mapping(uint256 => bytes32) public expected;
    event SendRootUpdated(bytes32 indexed outputRoot, bytes32 indexed l2BlockHash);
    event OutBoxTransactionExecuted(address indexed to, address indexed l2Sender, uint256 indexed zero, uint256 transactionIndex);
    constructor(address t) { token = t; }

    // test harness: a state covering `size` withdrawals is confirmed; `index` is expected with these fields
    function confirm(bytes32 l2BlockHash, uint256 size) external {
        confirmedSize[size] = true;
        emit SendRootUpdated(keccak256(abi.encode(size)), l2BlockHash);
    }
    function expect(uint256 index, bytes32 fields) external { expected[index] = fields; }

    function isSpent(uint256 index) external view returns (bool) { return spent[index]; }

    function executeTransaction(bytes32[] calldata proof, uint256 index, address l2Sender, address to, uint256 l2Block, uint256 l1Block,
        uint256 l2Timestamp, uint256 value, bytes calldata data) external {
        require(!spent[index], "ALREADY_SPENT");
        require(proof.length == 2 && proof[0] == keccak256(abi.encode(index, uint256(proof[1]))), "BAD_PROOF");
        require(confirmedSize[uint256(proof[1])] && uint256(proof[1]) > index, "NOT_CONFIRMED");
        require(expected[index] == keccak256(abi.encode(l2Sender, to, l2Block, l1Block, l2Timestamp, value, data)), "WRONG_FIELDS");
        spent[index] = true;
        require(IERC20Min(token).transfer(to, value), "transfer");
        emit OutBoxTransactionExecuted(to, l2Sender, 0, index);
    }
}

// Runtime code placed at 0x…64 on the child chain (ArbSys). Storage starts empty there, so the counter starts at 0.
contract MockArbSys {
    uint256 private next;
    event L2ToL1Tx(address caller, address indexed destination, uint256 indexed hash, uint256 indexed position,
        uint256 arbBlockNum, uint256 ethBlockNum, uint256 timestamp, uint256 callvalue, bytes data);
    function withdrawEth(address destination) external payable returns (uint256) {
        uint256 pos = next++;
        emit L2ToL1Tx(msg.sender, destination, uint256(keccak256(abi.encode(pos, destination, msg.value))), pos, block.number, 1, block.timestamp, msg.value, "");
        return pos;
    }
}

// Runtime code placed at 0x…C8 on the child chain (NodeInterface).
contract MockNodeInterface {
    function constructOutboxProof(uint64 size, uint64 leaf) external pure returns (bytes32 send, bytes32 root, bytes32[] memory proof) {
        require(leaf < size, "leaf");
        proof = new bytes32[](2);
        proof[0] = keccak256(abi.encode(uint256(leaf), uint256(size)));
        proof[1] = bytes32(uint256(size));
        send = proof[0];
        root = keccak256(abi.encode(uint256(size)));
    }
}
