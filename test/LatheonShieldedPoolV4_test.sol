// SPDX-License-Identifier: MIT
pragma solidity >=0.8.24 <0.9.0;

import "remix_tests.sol";
import "remix_accounts.sol";
import "../contracts/LatheonShieldedPoolV4.sol";
import "../contracts/LatheonToken.sol";
import "./MockVerifier.sol";
import "./WithdrawCallerV4.sol";

/// @title LatheonShieldedPoolV4 tests
/// @notice Mirrors LatheonShieldedPoolV3_test.sol exactly — the on-chain
///         logic (tree, roots, nullifier tracking) is identical between V3
///         and V4. V4's only actual difference from V3 lives in the
///         circuit/client layer (commitment depends on spendKey+viewKey
///         instead of a single secret), which this contract has no
///         awareness of — it just stores whatever commitment it's given.
///         So these tests deliberately use arbitrary numbers as
///         commitments, exactly like the V3 tests do, rather than
///         real spendKey/viewKey-derived values — that distinction lives
///         entirely off-chain, in circuits/withdraw_v2.circom.
contract LatheonShieldedPoolV4Test {

    LatheonToken token;
    MockVerifier verifier;
    LatheonShieldedPoolV4 pool;

    uint256 constant DENOMINATION = 100 * 10 ** 18;

    uint256[2] dummyPA;
    uint256[2][2] dummyPB;
    uint256[2] dummyPC;

    function beforeAll() public {
        token = new LatheonToken(address(this));
        verifier = new MockVerifier();
        pool = new LatheonShieldedPoolV4(address(token), address(verifier));

        token.approve(address(pool), 100_000 * 10 ** 18);
    }

    function checkDepositTransfersTokensAndInsertsLeaf() public {
        uint256 poolBalanceBefore = token.balanceOf(address(pool));

        pool.deposit(uint256(54321));

        Assert.equal(token.balanceOf(address(pool)), poolBalanceBefore + DENOMINATION, "pool balance should increase by exactly one DENOMINATION");
        Assert.equal(pool.nextIndex(), uint32(1), "nextIndex should be 1 after the first deposit");
    }

    function checkKnownRootRecognition() public {
        uint32 idx = pool.currentRootIndex();
        uint256 realRoot = pool.roots(idx);

        Assert.ok(pool.isKnownRoot(realRoot), "the pool's own current root should be recognized as known");
        Assert.ok(!pool.isKnownRoot(uint256(999999999)), "an arbitrary, never-produced number should not be a known root");
    }

    function checkWithdrawSucceedsWithValidProofAndKnownRoot() public {
        verifier.setNextResult(true);

        uint32 idx = pool.currentRootIndex();
        uint256 realRoot = pool.roots(idx);
        uint256 nullifier = uint256(135791);
        address recipient = TestsAccounts.getAccount(1);

        uint256[2] memory pubSignals = [realRoot, nullifier];
        uint256 recipientBefore = token.balanceOf(recipient);

        pool.withdraw(dummyPA, dummyPB, dummyPC, pubSignals, recipient);

        Assert.equal(token.balanceOf(recipient), recipientBefore + DENOMINATION, "recipient should receive exactly one DENOMINATION");
        Assert.ok(pool.nullifierHashes(nullifier), "the nullifier should now be marked as spent");
    }

    function checkWithdrawRevertsOnReusedNullifier() public {
        verifier.setNextResult(true);

        uint32 idx = pool.currentRootIndex();
        uint256 realRoot = pool.roots(idx);
        uint256 reusedNullifier = uint256(135791);
        address recipient = TestsAccounts.getAccount(2);

        uint256[2] memory pubSignals = [realRoot, reusedNullifier];

        WithdrawCallerV4 caller = new WithdrawCallerV4(address(pool));
        bool ok = caller.tryWithdraw(dummyPA, dummyPB, dummyPC, pubSignals, recipient);
        Assert.ok(!ok, "withdrawing with an already-spent nullifier should revert");
    }

    function checkWithdrawRevertsOnUnknownRoot() public {
        verifier.setNextResult(true);

        uint256 fakeRoot = uint256(246810);
        uint256 nullifier = uint256(864202);
        address recipient = TestsAccounts.getAccount(3);

        uint256[2] memory pubSignals = [fakeRoot, nullifier];

        WithdrawCallerV4 caller = new WithdrawCallerV4(address(pool));
        bool ok = caller.tryWithdraw(dummyPA, dummyPB, dummyPC, pubSignals, recipient);
        Assert.ok(!ok, "withdrawing against a root the pool never produced should revert");
    }

    function checkWithdrawRevertsWhenVerifierRejects() public {
        verifier.setNextResult(false);

        uint32 idx = pool.currentRootIndex();
        uint256 realRoot = pool.roots(idx);
        uint256 nullifier = uint256(975318);
        address recipient = TestsAccounts.getAccount(4);

        uint256[2] memory pubSignals = [realRoot, nullifier];

        WithdrawCallerV4 caller = new WithdrawCallerV4(address(pool));
        bool ok = caller.tryWithdraw(dummyPA, dummyPB, dummyPC, pubSignals, recipient);
        Assert.ok(!ok, "withdraw should revert when the verifier reports the proof as invalid");

        verifier.setNextResult(true);
    }
}
