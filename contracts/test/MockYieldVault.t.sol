// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TestUSDC} from "../src/mocks/TestUSDC.sol";
import {MockYieldVault} from "../src/mocks/MockYieldVault.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract MockYieldVaultTest is Test {
    TestUSDC internal usdc;
    MockYieldVault internal vault;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        usdc = new TestUSDC();
        vault = new MockYieldVault(IERC20(address(usdc)));
        usdc.mint(alice, 1_000_000e6);
        usdc.mint(bob, 1_000_000e6);
        usdc.mint(address(this), 1_000_000e6);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(vault), type(uint256).max);
    }

    function test_decimals_offset_gives_six_extra_decimals() public view {
        assertEq(vault.decimals(), 12);
        assertEq(vault.asset(), address(usdc));
    }

    function test_deposit_and_redeem_roundtrip() public {
        vm.prank(alice);
        uint256 shares = vault.deposit(100e6, alice);
        assertGt(shares, 0);
        vm.prank(alice);
        uint256 out = vault.redeem(shares, alice, alice);
        assertEq(out, 100e6);
    }

    function test_fund_yield_drips_linearly() public {
        vault.fund_yield(100e6, 1000);
        assertEq(vault.drip_total(), 100e6);
        assertEq(vault.unreleased(), 100e6);
        assertEq(vault.totalAssets(), 0);

        vm.warp(block.timestamp + 500);
        assertEq(vault.unreleased(), 50e6);
        assertEq(vault.totalAssets(), 50e6);

        vm.warp(block.timestamp + 500);
        assertEq(vault.unreleased(), 0);
        assertEq(vault.totalAssets(), 100e6);
    }

    function test_fund_yield_carries_unreleased_into_new_drip() public {
        vault.fund_yield(100e6, 1000);
        vm.warp(block.timestamp + 500);
        vault.fund_yield(40e6, 1000);
        assertEq(vault.drip_total(), 90e6);
        assertEq(vault.unreleased(), 90e6);
    }

    function test_fund_yield_zero_duration_reverts() public {
        vm.expectRevert(MockYieldVault.ZeroDuration.selector);
        vault.fund_yield(1, 0);
    }

    function test_fund_yield_only_owner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vault.fund_yield(1e6, 10);
    }

    function test_fund_yield_emits_event() public {
        vm.expectEmit(false, false, false, true, address(vault));
        emit MockYieldVault.YieldFunded(10e6, uint64(block.timestamp + 100));
        vault.fund_yield(10e6, 100);
    }

    function test_yield_accrues_to_depositors_pro_rata() public {
        vm.prank(alice);
        vault.deposit(100e6, alice);
        vm.prank(bob);
        vault.deposit(300e6, bob);
        usdc.approve(address(vault), 40e6);
        vault.fund_yield(40e6, 100);
        vm.warp(block.timestamp + 100);

        uint256 alice_shares = vault.balanceOf(alice);
        uint256 bob_shares = vault.balanceOf(bob);
        vm.prank(alice);
        uint256 a = vault.redeem(alice_shares, alice, alice);
        vm.prank(bob);
        uint256 b = vault.redeem(bob_shares, bob, bob);
        assertApproxEqAbs(a, 110e6, 2);
        assertApproxEqAbs(b, 330e6, 2);
    }

    function test_loss_for_testing_only_owner_and_reduces_assets() public {
        vm.prank(alice);
        vault.deposit(100e6, alice);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vault.loss_for_testing(1);

        vault.loss_for_testing(30e6);
        assertEq(vault.totalAssets(), 70e6);
    }

    function test_inflation_attack_is_mitigated() public {
        // Attacker deposits 1 wei and donates a large amount to inflate the share price.
        address attacker = makeAddr("attacker");
        usdc.mint(attacker, 1_000_000e6);
        vm.startPrank(attacker);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(1, attacker);
        usdc.transfer(address(vault), 100e6);
        vm.stopPrank();

        // Victim deposits 10 USDC after the donation.
        vm.prank(alice);
        uint256 victim_shares = vault.deposit(10e6, alice);
        assertGt(victim_shares, 0);

        vm.prank(alice);
        uint256 back = vault.redeem(victim_shares, alice, alice);
        // With the 6-decimal offset the victim loses at most a negligible rounding amount, not the full deposit.
        assertGt(back, 9e6);
    }
}
