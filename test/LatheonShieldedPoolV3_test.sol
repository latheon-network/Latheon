// SPDX-License-Identifier: MIT
pragma solidity >=0.8.24 <0.9.0;

import "remix_tests.sol";
import "remix_accounts.sol";
import "../contracts/LatheonShieldedPoolV3.sol";
import "../contracts/LatheonToken.sol";
import "./MockVerifier.sol";
import "./WithdrawCaller.sol";

/// @title LatheonShieldedPoolV3 tests
/// @notice Tests the pool's OWN logic — deposits, root tracking, nullifier
///         tracking, access to funds — using MockVerifier in place of the
///         real Groth16Verifier. A real proof can't be generated inside a
///         Solidity test (that happens off-chain); the real verifier's
///         correctness is instead confirmed by the actual on-chain proof
///         already verified on Sepolia (see STATUS.md). This file answers a
///         different, equally important question: assuming a proof is
///         valid (or invalid), does the pool contract itself behave
///         correctly around it?
contract LatheonShieldedPoolV3Test {

    LatheonToken token;
    MockVerifier verifier;
    LatheonShieldedPoolV3 pool;

    uint256 constant DENOMINATION = 100 * 10 ** 18;

    uint256[2] dummyPA;
    uint256[2][2] dummyPB;
    uint256[2] dummyPC;

    function beforeAll() public {
        token = new LatheonToken(address(this));
        verifier = new MockVerifier();
        pool = new LatheonShieldedPoolV3(address(token), address(verifier));

        token.approve(address(pool), 100_000 * 10 ** 18);
    }

    /// @notice A deposit should transfer tokens into the pool and insert a
    ///         leaf, moving nextIndex from 0 to 1.
    function checkDepositTransfersTokensAndInsertsLeaf() public {
        uint256 poolBalanceBefore = token.balanceOf(address(pool));

        pool.deposit(uint256(12345));

        Assert.equal(token.balanceOf(address(pool)), poolBalanceBefore + DENOMINATION, "pool balance should increase by exactly one DENOMINATION");
        Assert.equal(pool.nextIndex(), uint32(1), "nextIndex should be 1 after the first deposit");
    }

    /// @notice After a deposit, the resulting root should be recognized by
    ///         isKnownRoot() — and an arbitrary, never-produced number
    ///         should NOT be.
    function checkKnownRootRecognition() public {
        uint32 idx = pool.currentRootIndex();
        uint256 realRoot = pool.roots(idx);

        Assert.ok(pool.isKnownRoot(realRoot), "the pool's own current root should be recognized as known");
        Assert.ok(!pool.isKnownRoot(uint256(999999999)), "an arbitrary, never-produced number should not be a known root");
    }

    /// @notice With MockVerifier set to approve, and a real known root,
    ///         withdraw() should succeed and pay out the recipient.
    function checkWithdrawSucceedsWithValidProofAndKnownRoot() public {
        verifier.setNextResult(true);

        uint32 idx = pool.currentRootIndex();
        uint256 realRoot = pool.roots(idx);
        uint256 nullifier = uint256(777777);
        address recipient = TestsAccounts.getAccount(1);

        uint256[2] memory pubSignals = [realRoot, nullifier];
        uint256 recipientBefore = token.balanceOf(recipient);

        pool.withdraw(dummyPA, dummyPB, dummyPC, pubSignals, recipient);

        Assert.equal(token.balanceOf(recipient), recipientBefore + DENOMINATION, "recipient should receive exactly one DENOMINATION");
        Assert.ok(pool.nullifierHashes(nullifier), "the nullifier should now be marked as spent");
    }

    /// @notice The same nullifier must not be spendable twice, even with a
    ///         valid proof and a valid root — this is the double-spend guard.
    function checkWithdrawRevertsOnReusedNullifier() public {
        verifier.setNextResult(true);

        uint32 idx = pool.currentRootIndex();
        uint256 realRoot = pool.roots(idx);
        uint256 reusedNullifier = uint256(777777);
        address recipient = TestsAccounts.getAccount(2);

        uint256[2] memory pubSignals = [realRoot, reusedNullifier];

        WithdrawCaller caller = new WithdrawCaller(address(pool));
        bool ok = caller.tryWithdraw(dummyPA, dummyPB, dummyPC, pubSignals, recipient);
        Assert.ok(!ok, "withdrawing with an already-spent nullifier should revert");
    }

    /// @notice A root that was never actually produced by this pool must be
    ///         rejected, even if MockVerifier would approve the proof.
    function checkWithdrawRevertsOnUnknownRoot() public {
        verifier.setNextResult(true);

        uint256 fakeRoot = uint256(123123123);
        uint256 nullifier = uint256(888888);
        address recipient = TestsAccounts.getAccount(3);

        uint256[2] memory pubSignals = [fakeRoot, nullifier];

        WithdrawCaller caller = new WithdrawCaller(address(pool));
        bool ok = caller.tryWithdraw(dummyPA, dummyPB, dummyPC, pubSignals, recipient);
        Assert.ok(!ok, "withdrawing against a root the pool never produced should revert");
    }

    /// @notice If the verifier itself says the proof is invalid, the
    ///         withdrawal must be rejected even against a real, known root.
    function checkWithdrawRevertsWhenVerifierRejects() public {
        verifier.setNextResult(false);

        uint32 idx = pool.currentRootIndex();
        uint256 realRoot = pool.roots(idx);
        uint256 nullifier = uint256(999888);
        address recipient = TestsAccounts.getAccount(4);

        uint256[2] memory pubSignals = [realRoot, nullifier];

        WithdrawCaller caller = new WithdrawCaller(address(pool));
        bool ok = caller.tryWithdraw(dummyPA, dummyPB, dummyPC, pubSignals, recipient);
        Assert.ok(!ok, "withdraw should revert when the verifier reports the proof as invalid");

        verifier.setNextResult(true);
    }
}
