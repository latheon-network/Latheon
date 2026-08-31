// SPDX-License-Identifier: MIT
pragma solidity >=0.8.24 <0.9.0;

import "remix_tests.sol";
import "remix_accounts.sol";
import "../contracts/LatheonFaucet.sol";
import "../contracts/LatheonToken.sol";
import "./FaucetClaimer.sol";

/// @title LatheonFaucet tests
/// @notice Run via Remix's "Solidity Unit Testing" plugin — no npm/hardhat
///         needed, everything runs inside Remix itself.
///
/// @dev ASSUMPTION FLAGGED: the `new LatheonToken(address(this))` line below
///      assumes a constructor taking a single `initialOwner` address, matching
///      the pattern used elsewhere in this codebase (Ownable). If your actual
///      LatheonToken.sol constructor differs, this line is the only one that
///      needs adjusting — everything else in this file is independent of it.
contract LatheonFaucetTest {

    LatheonToken token;
    LatheonFaucet faucet;
    FaucetClaimer claimerA;
    FaucetClaimer claimerB;

    function beforeAll() public {
        token = new LatheonToken(address(this));
        faucet = new LatheonFaucet(address(token));
        claimerA = new FaucetClaimer(address(faucet));
        claimerB = new FaucetClaimer(address(faucet));

        // Fund the faucet with enough for exactly 10 claims (500 LTH each)
        token.transfer(address(faucet), 5000 * 10 ** 18);
    }

    /// @notice claimsRemaining() should reflect the funded balance divided
    ///         by the fixed drip amount.
    function checkClaimsRemaining() public {
        Assert.equal(faucet.claimsRemaining(), uint256(10), "faucet should report 10 claims remaining after funding with 5000 LTH");
    }

    /// @notice A fresh address's first claim should succeed and deliver
    ///         exactly DRIP_AMOUNT.
    function checkFirstClaimSucceeds() public {
        bool ok = claimerA.doClaim();
        Assert.ok(ok, "claimerA's first claim should succeed");
        Assert.equal(token.balanceOf(address(claimerA)), 500 * 10 ** 18, "claimerA should receive exactly 500 LTH");
    }

    /// @notice A second claim from the SAME address within 24h must revert.
    function checkSecondClaimFromSameAddressReverts() public {
        bool ok = claimerA.doClaim();
        Assert.ok(!ok, "claiming twice within 24h from the same address should revert");
    }

    /// @notice A different address should be able to claim independently —
    ///         the cooldown is per-address, not global to the faucet.
    function checkDifferentAddressCanClaimIndependently() public {
        bool ok = claimerB.doClaim();
        Assert.ok(ok, "a different address should be able to claim regardless of claimerA's cooldown");
    }

    /// @notice timeUntilNextClaim should return 0 for an address that has
    ///         never claimed.
    function checkTimeUntilNextClaimForNewAddress() public {
        address neverClaimed = TestsAccounts.getAccount(3);
        Assert.equal(faucet.timeUntilNextClaim(neverClaimed), uint256(0), "an address that has never claimed should be able to claim right now");
    }

    /// @notice After claiming, timeUntilNextClaim should report a nonzero,
    ///         bounded remaining cooldown.
    function checkTimeUntilNextClaimAfterClaiming() public {
        uint256 remaining = faucet.timeUntilNextClaim(address(claimerA));
        Assert.ok(remaining > 0, "claimerA should have a nonzero cooldown remaining right after claiming");
        Assert.ok(remaining <= 24 hours, "cooldown remaining should never exceed the full 24h window");
    }
}
