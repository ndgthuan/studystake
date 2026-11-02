// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {TestUSDC} from "../src/mocks/TestUSDC.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract TestUSDCTest is Test {
    TestUSDC internal usdc;
    address internal alice = makeAddr("alice");

    function setUp() public {
        usdc = new TestUSDC();
    }

    /// @notice Faucet mints 1000 tUSDC, enforces a 24h cooldown and works again after it.
    function test_faucet_mints_and_enforces_cooldown() public {
        vm.warp(1_000_000);
        vm.prank(alice);
        usdc.faucet();
        assertEq(usdc.balanceOf(alice), 1000e6);
        assertEq(usdc.last_faucet(alice), 1_000_000);

        uint256 next_time = 1_000_000 + 1 days;
        vm.warp(next_time - 1);
        vm.expectRevert(abi.encodeWithSelector(TestUSDC.FaucetCooldown.selector, next_time));
        vm.prank(alice);
        usdc.faucet();
        assertEq(usdc.balanceOf(alice), 1000e6);

        vm.warp(next_time);
        vm.prank(alice);
        usdc.faucet();
        assertEq(usdc.balanceOf(alice), 2000e6);
    }

    /// @notice The cooldown is per address. A second address is not blocked by the first one's claim.
    function test_faucet_cooldown_is_per_address() public {
        vm.prank(alice);
        usdc.faucet();
        address bob = makeAddr("bob");
        vm.prank(bob);
        usdc.faucet();
        assertEq(usdc.balanceOf(bob), 1000e6);
    }

    /// @notice mint is owner only and the test contract is the owner.
    function test_mint_is_owner_only() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vm.prank(alice);
        usdc.mint(alice, 1e6);

        usdc.mint(alice, 5e6);
        assertEq(usdc.balanceOf(alice), 5e6);
    }
}
