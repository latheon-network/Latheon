// SPDX-License-Identifier: MIT
pragma solidity >=0.8.24 <0.9.0;

import "remix_tests.sol";
import "remix_accounts.sol";
import "../contracts/LatheonToken.sol";
import "./TokenTestHelpers.sol";

/// @title LatheonToken tests
/// @notice Run via Remix's "Solidity Unit Testing" plugin.
contract LatheonTokenTest {

    LatheonToken token;

    function beforeAll() public {
        // This test contract itself becomes the deployer and initial owner —
        // address(this) inside beforeAll() is the test contract's own address.
        token = new LatheonToken(address(this));
    }

    /// @notice Total supply should be exactly 100,000,000 LTH at deployment.
    function checkInitialSupply() public {
        Assert.equal(token.totalSupply(), uint256(100_000_000 * 10 ** 18), "initial supply should be exactly 100M LTH");
    }

    /// @notice All initial supply should sit with the deployer (this test contract).
    function checkInitialBalanceGoesToDeployer() public {
        Assert.equal(token.balanceOf(address(this)), uint256(100_000_000 * 10 ** 18), "deployer should hold the full initial supply");
    }

    /// @notice Basic transfer should move tokens and update both balances.
    function checkTransferMovesTokens() public {
        address recipient = TestsAccounts.getAccount(1);
        uint256 amount = 1000 * 10 ** 18;

        uint256 senderBefore = token.balanceOf(address(this));
        bool ok = token.transfer(recipient, amount);

        Assert.ok(ok, "transfer should succeed");
        Assert.equal(token.balanceOf(recipient), amount, "recipient should receive exactly the transferred amount");
        Assert.equal(token.balanceOf(address(this)), senderBefore - amount, "sender balance should decrease by the transferred amount");
    }

    /// @notice The owner should be able to mint additional tokens.
    function checkOwnerCanMint() public {
        address recipient = TestsAccounts.getAccount(2);
        uint256 supplyBefore = token.totalSupply();
        uint256 mintAmount = 5000 * 10 ** 18;

        token.mint(recipient, mintAmount);

        Assert.equal(token.balanceOf(recipient), mintAmount, "recipient should receive the newly minted tokens");
        Assert.equal(token.totalSupply(), supplyBefore + mintAmount, "total supply should increase by exactly the minted amount");
    }

    /// @notice A non-owner must not be able to mint — this is the security
    ///         property the whole `onlyOwner` restriction exists for.
    function checkNonOwnerCannotMint() public {
        // A freshly deployed plain address (via a tiny helper) has no special
        // relationship to the token — simulate a stranger calling mint().
        NonOwnerCaller stranger = new NonOwnerCaller(address(token));
        bool ok = stranger.tryMint(TestsAccounts.getAccount(3), 1000 * 10 ** 18);
        Assert.ok(!ok, "a non-owner calling mint() should revert");
    }

    /// @notice approve + transferFrom should work together, the standard
    ///         ERC20 delegated-transfer flow our own contracts rely on.
    function checkApproveAndTransferFrom() public {
        SpenderCaller spender = new SpenderCaller(address(token));
        uint256 amount = 200 * 10 ** 18;

        token.approve(address(spender), amount);
        bool ok = spender.trySpend(address(this), TestsAccounts.getAccount(4), amount);

        Assert.ok(ok, "approved spender should be able to transferFrom the approved amount");
        Assert.equal(token.balanceOf(TestsAccounts.getAccount(4)), amount, "recipient should receive the delegated transfer");
    }
}
