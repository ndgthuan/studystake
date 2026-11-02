// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {StudyBadge} from "../src/StudyBadge.sol";

contract StudyBadgeTest is Test {
    StudyBadge internal badge;
    address internal admin = makeAddr("admin");
    address internal manager = makeAddr("manager");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        badge = new StudyBadge(admin);
        bytes32 manager_role = badge.MANAGER_ROLE();
        vm.prank(admin);
        badge.grantRole(manager_role, manager);
    }

    function test_constructor_rejects_zero_admin() public {
        vm.expectRevert(StudyBadge.ZeroAddress.selector);
        new StudyBadge(address(0));
    }

    function test_only_manager_can_record() public {
        vm.prank(alice);
        vm.expectRevert();
        badge.record_result(alice, true);
    }

    function test_record_zero_account_reverts() public {
        vm.prank(manager);
        vm.expectRevert(StudyBadge.ZeroAddress.selector);
        badge.record_result(address(0), true);
    }

    function test_first_completion_mints_and_counts() public {
        vm.expectEmit(true, false, false, true, address(badge));
        emit StudyBadge.Locked(1);
        vm.prank(manager);
        badge.record_result(alice, true);

        assertEq(badge.badge_of(alice), 1);
        assertEq(badge.ownerOf(1), alice);
        (uint32 streak, uint32 best, uint32 done, uint32 failed,) = badge.stats_of(1);
        assertEq(streak, 1);
        assertEq(best, 1);
        assertEq(done, 1);
        assertEq(failed, 0);
    }

    function test_streak_and_best_and_failure_reset() public {
        vm.startPrank(manager);
        badge.record_result(alice, true);
        badge.record_result(alice, true);
        badge.record_result(alice, true);
        (uint32 streak, uint32 best,,,) = badge.stats_of(1);
        assertEq(streak, 3);
        assertEq(best, 3);

        badge.record_result(alice, false);
        (streak, best,,,) = badge.stats_of(1);
        assertEq(streak, 0);
        assertEq(best, 3);

        badge.record_result(alice, true);
        (uint32 streak2, uint32 best2, uint32 done2, uint32 failed2,) = badge.stats_of(1);
        assertEq(streak2, 1);
        assertEq(best2, 3);
        assertEq(done2, 4);
        assertEq(failed2, 1);
        vm.stopPrank();
    }

    function test_failure_without_badge_is_noop() public {
        vm.prank(manager);
        badge.record_result(bob, false);
        assertEq(badge.badge_of(bob), 0);
        assertEq(badge.next_token_id(), 1);
    }

    function test_one_badge_per_wallet() public {
        vm.startPrank(manager);
        badge.record_result(alice, true);
        badge.record_result(alice, true);
        vm.stopPrank();
        assertEq(badge.balanceOf(alice), 1);
        assertEq(badge.next_token_id(), 2);
    }

    function test_transfer_reverts_soulbound() public {
        vm.prank(manager);
        badge.record_result(alice, true);
        vm.prank(alice);
        vm.expectRevert(StudyBadge.Soulbound.selector);
        badge.transferFrom(alice, bob, 1);
    }

    function test_safe_transfer_reverts_soulbound() public {
        vm.prank(manager);
        badge.record_result(alice, true);
        vm.prank(alice);
        vm.expectRevert(StudyBadge.Soulbound.selector);
        badge.safeTransferFrom(alice, bob, 1);
    }

    function test_approve_reverts() public {
        vm.prank(manager);
        badge.record_result(alice, true);
        vm.prank(alice);
        vm.expectRevert(StudyBadge.Soulbound.selector);
        badge.approve(bob, 1);
    }

    function test_set_approval_for_all_reverts() public {
        vm.prank(alice);
        vm.expectRevert(StudyBadge.Soulbound.selector);
        badge.setApprovalForAll(bob, true);
    }

    function test_locked_true_and_reverts_for_missing_token() public {
        vm.prank(manager);
        badge.record_result(alice, true);
        assertTrue(badge.locked(1));
        vm.expectRevert();
        badge.locked(99);
    }

    function test_supports_erc5192_and_erc721() public view {
        assertTrue(badge.supportsInterface(0xb45a3c0e));
        assertTrue(badge.supportsInterface(0x80ac58cd));
        assertTrue(badge.supportsInterface(0x01ffc9a7));
        assertFalse(badge.supportsInterface(0xffffffff));
    }

    function test_token_uri_is_base64_json() public {
        vm.prank(manager);
        badge.record_result(alice, true);
        string memory uri = badge.tokenURI(1);
        bytes memory b = bytes(uri);
        bytes memory prefix = bytes("data:application/json;base64,");
        assertGt(b.length, prefix.length);
        for (uint256 i = 0; i < prefix.length; i++) {
            assertEq(b[i], prefix[i]);
        }
    }

    function test_token_uri_reverts_for_missing_token() public {
        vm.expectRevert();
        badge.tokenURI(1);
    }

    function test_tier_thresholds() public view {
        assertEq(badge.tier_of(0), "Bronze");
        assertEq(badge.tier_of(2), "Bronze");
        assertEq(badge.tier_of(3), "Silver");
        assertEq(badge.tier_of(9), "Silver");
        assertEq(badge.tier_of(10), "Gold");
    }
}
