// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {StudyBadge} from "../src/StudyBadge.sol";
import {StudyStakeManager} from "../src/StudyStakeManager.sol";
import {IStudyBadge} from "../src/interfaces/IStudyBadge.sol";
import {TestUSDC} from "../src/mocks/TestUSDC.sol";
import {MockYieldVault} from "../src/mocks/MockYieldVault.sol";
import {MerkleHelper} from "./utils/MerkleHelper.sol";
import {StudyStakeBase} from "./utils/StudyStakeBase.sol";

/// @dev Badge that always reverts. Used to check that a broken badge cannot block claims.
contract RevertingBadge is IStudyBadge {
    error BadgeDown();

    function record_result(address, bool) external pure {
        revert BadgeDown();
    }
}

/// @dev Badge that never returns: it burns every gas unit it is given. Used to check that a badge cannot block claims.
contract GasBurningBadge is IStudyBadge {
    function record_result(address, bool) external pure {
        uint256 spin = 0;
        while (true) {
            spin += 1;
        }
    }
}

/// @dev Token whose transfers into `blocked` revert, like a blacklisted USDC recipient.
contract BlacklistToken is ERC20 {
    error Blacklisted();

    address public immutable blocked;

    constructor(address blocked_) ERC20("Blacklist Token", "BLT") {
        blocked = blocked_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (to == blocked) revert Blacklisted();
        super._update(from, to, value);
    }
}

contract StudyStakeManagerTest is StudyStakeBase {
    bytes32 internal constant ROOT_FAKE = bytes32(uint256(0x1234));

    function setUp() public {
        _deploy_stack();
    }

    // ---------------------------------------------------------------------
    // Admin and roles
    // ---------------------------------------------------------------------

    function test_constructor_rejects_zero_addresses() public {
        vm.expectRevert(StudyStakeManager.ZeroAddress.selector);
        new StudyStakeManager(address(0), treasury, IStudyBadge(address(badge)));
        vm.expectRevert(StudyStakeManager.ZeroAddress.selector);
        new StudyStakeManager(address(this), address(0), IStudyBadge(address(badge)));
        vm.expectRevert(StudyStakeManager.ZeroAddress.selector);
        new StudyStakeManager(address(this), treasury, IStudyBadge(address(0)));
    }

    function test_set_treasury_admin_only() public {
        address new_treasury = makeAddr("new_treasury");
        vm.expectRevert();
        vm.prank(alice);
        manager.set_treasury(new_treasury);

        vm.expectRevert(StudyStakeManager.ZeroAddress.selector);
        manager.set_treasury(address(0));

        manager.set_treasury(new_treasury);
        assertEq(manager.treasury(), new_treasury);
    }

    function test_set_allowlists_admin_only_and_nonzero() public {
        address other = makeAddr("other_token");
        vm.expectRevert();
        vm.prank(alice);
        manager.set_allowed_token(other, true);

        vm.expectRevert(StudyStakeManager.ZeroAddress.selector);
        manager.set_allowed_token(address(0), true);
        vm.expectRevert(StudyStakeManager.ZeroAddress.selector);
        manager.set_allowed_vault(address(0), true);

        manager.set_allowed_token(other, true);
        assertTrue(manager.allowed_token(other));
        manager.set_allowed_token(other, false);
        assertFalse(manager.allowed_token(other));

        manager.set_allowed_vault(other, true);
        assertTrue(manager.allowed_vault(other));
    }

    function test_pause_guardian_only_and_blocks_create() public {
        vm.expectRevert();
        vm.prank(alice);
        manager.pause();

        vm.prank(guardian);
        manager.pause();
        assertTrue(manager.paused());

        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        vm.prank(creator);
        manager.create_challenge(
            IERC20(address(usdc)),
            IERC4626(address(vault)),
            MIN_STAKE,
            MAX_STAKE,
            join_deadline,
            end_time,
            SETTLE_GRACE,
            DISPUTE_WINDOW,
            bytes32(0),
            ""
        );

        vm.expectRevert();
        vm.prank(alice);
        manager.unpause();
        vm.prank(guardian);
        manager.unpause();
        assertFalse(manager.paused());
    }

    function test_pause_blocks_join_sponsor_settle_but_not_claim_path() public {
        uint256 id = _create();
        _join(id, alice, 10e6);
        _join(id, bob, 20e6);

        vm.prank(guardian);
        manager.pause();

        vm.startPrank(carol);
        usdc.approve(address(manager), type(uint256).max);
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        manager.join(id, 5e6);
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        manager.sponsor(id, 5e6);
        vm.stopPrank();

        _to_end();
        vm.prank(oracle);
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        manager.settle(id, ROOT_FAKE, 1, 10e6, bytes32(0));

        // Settle must happen while unpaused in the normal flow, so unpause and run the rest while paused again.
        vm.prank(guardian);
        manager.unpause();
        address[] memory done = _one(alice);
        _settle(id, done);

        vm.prank(guardian);
        manager.pause();
        _after_dispute(id);
        manager.finalize(id);
        uint256 alice_bal = usdc.balanceOf(alice);
        bytes32[] memory proof_alice_0_1 = _proof(id, done, 0);
        vm.prank(alice);
        manager.claim(id, true, proof_alice_0_1);
        assertGt(usdc.balanceOf(alice), alice_bal);
    }

    // ---------------------------------------------------------------------
    // create_challenge
    // ---------------------------------------------------------------------

    function test_create_challenge_happy_path() public {
        uint256 id = _create();
        assertEq(id, 1);
        assertEq(manager.challenge_count(), 1);
        StudyStakeManager.Challenge memory c = manager.get_challenge(id);
        assertEq(uint8(c.status), uint8(StudyStakeManager.Status.Open));
        assertEq(c.creator, creator);
        assertEq(address(c.token), address(usdc));
        assertEq(address(c.vault), address(vault));
        assertEq(c.min_stake, MIN_STAKE);
        assertEq(c.max_stake, MAX_STAKE);
        assertEq(c.join_deadline, join_deadline);
        assertEq(c.end_time, end_time);
        assertEq(c.metadata_hash, keccak256("metadata"));
    }

    function test_create_challenge_creator_role_only() public {
        bytes32 creator_role = manager.CREATOR_ROLE();
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, creator_role)
        );
        _create_raw(
            alice,
            address(usdc),
            address(vault),
            MIN_STAKE,
            MAX_STAKE,
            join_deadline,
            end_time,
            SETTLE_GRACE,
            DISPUTE_WINDOW
        );
    }

    function test_create_challenge_token_not_allowed() public {
        TestUSDC other = new TestUSDC();
        vm.expectRevert(StudyStakeManager.TokenNotAllowed.selector);
        _create_raw(
            creator,
            address(other),
            address(vault),
            MIN_STAKE,
            MAX_STAKE,
            join_deadline,
            end_time,
            SETTLE_GRACE,
            DISPUTE_WINDOW
        );
    }

    function test_create_challenge_vault_not_allowed() public {
        MockYieldVault v2 = new MockYieldVault(IERC20(address(usdc)));
        vm.expectRevert(StudyStakeManager.VaultNotAllowed.selector);
        _create_raw(
            creator,
            address(usdc),
            address(v2),
            MIN_STAKE,
            MAX_STAKE,
            join_deadline,
            end_time,
            SETTLE_GRACE,
            DISPUTE_WINDOW
        );
    }

    function test_create_challenge_vault_asset_mismatch() public {
        TestUSDC other = new TestUSDC();
        manager.set_allowed_token(address(other), true);
        vm.expectRevert(StudyStakeManager.VaultAssetMismatch.selector);
        _create_raw(
            creator,
            address(other),
            address(vault),
            MIN_STAKE,
            MAX_STAKE,
            join_deadline,
            end_time,
            SETTLE_GRACE,
            DISPUTE_WINDOW
        );
    }

    function test_create_challenge_invalid_stake_params() public {
        vm.expectRevert(StudyStakeManager.InvalidParams.selector);
        _create_raw(
            creator, address(usdc), address(vault), 0, MAX_STAKE, join_deadline, end_time, SETTLE_GRACE, DISPUTE_WINDOW
        );

        vm.expectRevert(StudyStakeManager.InvalidParams.selector);
        _create_raw(
            creator,
            address(usdc),
            address(vault),
            MAX_STAKE,
            MIN_STAKE,
            join_deadline,
            end_time,
            SETTLE_GRACE,
            DISPUTE_WINDOW
        );
    }

    function test_create_challenge_invalid_time_params() public {
        vm.expectRevert(StudyStakeManager.InvalidParams.selector);
        _create_raw(
            creator,
            address(usdc),
            address(vault),
            MIN_STAKE,
            MAX_STAKE,
            uint64(block.timestamp),
            end_time,
            SETTLE_GRACE,
            DISPUTE_WINDOW
        );

        vm.expectRevert(StudyStakeManager.InvalidParams.selector);
        _create_raw(
            creator,
            address(usdc),
            address(vault),
            MIN_STAKE,
            MAX_STAKE,
            join_deadline,
            join_deadline - 1,
            SETTLE_GRACE,
            DISPUTE_WINDOW
        );
    }

    function test_create_challenge_invalid_windows() public {
        vm.expectRevert(StudyStakeManager.InvalidParams.selector);
        _create_raw(
            creator,
            address(usdc),
            address(vault),
            MIN_STAKE,
            MAX_STAKE,
            join_deadline,
            end_time,
            SETTLE_GRACE,
            1 minutes
        );

        vm.expectRevert(StudyStakeManager.InvalidParams.selector);
        _create_raw(
            creator, address(usdc), address(vault), MIN_STAKE, MAX_STAKE, join_deadline, end_time, SETTLE_GRACE, 8 days
        );

        vm.expectRevert(StudyStakeManager.InvalidParams.selector);
        _create_raw(
            creator,
            address(usdc),
            address(vault),
            MIN_STAKE,
            MAX_STAKE,
            join_deadline,
            end_time,
            5 minutes,
            DISPUTE_WINDOW
        );

        vm.expectRevert(StudyStakeManager.InvalidParams.selector);
        _create_raw(
            creator,
            address(usdc),
            address(vault),
            MIN_STAKE,
            MAX_STAKE,
            join_deadline,
            end_time,
            15 days,
            DISPUTE_WINDOW
        );
    }

    // ---------------------------------------------------------------------
    // sponsor
    // ---------------------------------------------------------------------

    function test_sponsor_happy_path_holds_tokens_raw() public {
        uint256 id = _create();
        uint256 before_bal = usdc.balanceOf(address(manager));
        _sponsor(id, sponsor, 5e6);
        assertEq(manager.get_challenge(id).total_bonus, 5e6);
        assertEq(manager.sponsor_amount_of(id, sponsor), 5e6);
        assertEq(usdc.balanceOf(address(manager)), before_bal + 5e6);
        assertEq(vault.balanceOf(address(manager)), 0);
    }

    function test_sponsor_reverts() public {
        vm.expectRevert(StudyStakeManager.WrongStatus.selector);
        vm.prank(sponsor);
        manager.sponsor(99, 1e6);

        uint256 id = _create();
        vm.expectRevert(StudyStakeManager.ZeroAmount.selector);
        vm.prank(sponsor);
        manager.sponsor(id, 0);

        vm.warp(end_time);
        vm.expectRevert(StudyStakeManager.TooLate.selector);
        vm.prank(sponsor);
        manager.sponsor(id, 1e6);
    }

    // ---------------------------------------------------------------------
    // join
    // ---------------------------------------------------------------------

    function test_join_happy_path_and_accounting() public {
        uint256 id = _create();
        _join(id, alice, 10e6);
        _join(id, bob, 20e6);
        StudyStakeManager.Challenge memory c = manager.get_challenge(id);
        assertEq(c.total_principal, 30e6);
        assertEq(c.participant_count, 2);
        assertGt(c.total_shares, 0);
        assertEq(manager.stake_of(id, alice), 10e6);
        assertEq(manager.joined_at(id, alice), block.timestamp);
        assertEq(vault.balanceOf(address(manager)), c.total_shares);
    }

    function test_join_reverts() public {
        vm.expectRevert(StudyStakeManager.WrongStatus.selector);
        vm.prank(alice);
        manager.join(99, 1e6);

        uint256 id = _create();
        vm.prank(alice);
        usdc.approve(address(manager), type(uint256).max);

        vm.expectRevert(StudyStakeManager.StakeOutOfRange.selector);
        vm.prank(alice);
        manager.join(id, MIN_STAKE - 1);

        vm.expectRevert(StudyStakeManager.StakeOutOfRange.selector);
        vm.prank(alice);
        manager.join(id, MAX_STAKE + 1);

        _join(id, alice, 10e6);
        vm.expectRevert(StudyStakeManager.AlreadyJoined.selector);
        vm.prank(alice);
        manager.join(id, 10e6);

        vm.warp(join_deadline);
        vm.expectRevert(StudyStakeManager.TooLate.selector);
        vm.prank(bob);
        manager.join(id, 10e6);
    }

    function test_join_with_permit_happy_path() public {
        (address pu, uint256 pk) = makeAddrAndKey("permit_user");
        usdc.mint(pu, 10e6);
        uint256 id = _create();
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permit_sig(pk, pu, address(manager), 10e6, deadline);

        vm.prank(pu);
        manager.join_with_permit(id, 10e6, deadline, v, r, s);
        assertEq(manager.stake_of(id, pu), 10e6);
        assertEq(usdc.allowance(pu, address(manager)), 0);
    }

    function test_join_with_permit_front_run_permit_still_joins() public {
        (address pu, uint256 pk) = makeAddrAndKey("permit_user");
        usdc.mint(pu, 10e6);
        uint256 id = _create();
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permit_sig(pk, pu, address(manager), 10e6, deadline);

        // Attacker consumes the permit nonce first.
        vm.prank(alice);
        usdc.permit(pu, address(manager), 10e6, deadline, v, r, s);

        vm.prank(pu);
        manager.join_with_permit(id, 10e6, deadline, v, r, s);
        assertEq(manager.stake_of(id, pu), 10e6);
    }

    function test_join_with_permit_bad_signature_without_allowance_reverts() public {
        (address pu, uint256 pk) = makeAddrAndKey("permit_user");
        usdc.mint(pu, 10e6);
        uint256 id = _create();
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permit_sig(pk, pu, address(manager), 10e6, deadline);

        vm.prank(pu);
        vm.expectRevert();
        manager.join_with_permit(id, 10e6, deadline, v, r, bytes32(uint256(s) + 1));
    }

    function test_join_with_permit_expired_deadline_without_allowance_reverts() public {
        (address pu, uint256 pk) = makeAddrAndKey("permit_user");
        usdc.mint(pu, 10e6);
        uint256 id = _create();
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permit_sig(pk, pu, address(manager), 10e6, deadline);
        vm.warp(deadline + 1);

        vm.prank(pu);
        vm.expectRevert();
        manager.join_with_permit(id, 10e6, deadline, v, r, s);
    }

    /// @dev EIP-2612 signature for the TestUSDC domain.
    function _permit_sig(uint256 pk, address owner_, address spender, uint256 value, uint256 deadline)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 type_hash =
            keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
        bytes32 struct_hash = keccak256(abi.encode(type_hash, owner_, spender, value, usdc.nonces(owner_), deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), struct_hash));
        (v, r, s) = vm.sign(pk, digest);
    }

    // ---------------------------------------------------------------------
    // settle
    // ---------------------------------------------------------------------

    function test_settle_happy_path() public {
        uint256 id = _create();
        _join(id, alice, 10e6);
        _join(id, bob, 20e6);
        _to_end();
        address[] memory done = _one(alice);
        _settle(id, done);

        StudyStakeManager.Challenge memory c = manager.get_challenge(id);
        assertEq(uint8(c.status), uint8(StudyStakeManager.Status.Settled));
        assertEq(c.completed_count, 1);
        assertEq(c.completed_stake, 10e6);
        assertEq(c.settled_at, block.timestamp);
    }

    function test_settle_reverts() public {
        uint256 id = _create();
        _join(id, alice, 10e6);

        vm.expectRevert();
        vm.prank(alice);
        manager.settle(id, ROOT_FAKE, 1, 10e6, bytes32(0));

        vm.expectRevert(StudyStakeManager.TooEarly.selector);
        vm.prank(oracle);
        manager.settle(id, ROOT_FAKE, 1, 10e6, bytes32(0));

        vm.warp(end_time + SETTLE_GRACE);
        vm.expectRevert(StudyStakeManager.TooLate.selector);
        vm.prank(oracle);
        manager.settle(id, ROOT_FAKE, 1, 10e6, bytes32(0));
    }

    function test_settle_invalid_settlement_checks() public {
        uint256 id = _create();
        _join(id, alice, 10e6);
        _to_end();

        vm.startPrank(oracle);
        vm.expectRevert(StudyStakeManager.InvalidSettlement.selector);
        manager.settle(id, ROOT_FAKE, 2, 10e6, bytes32(0)); // count > participants

        vm.expectRevert(StudyStakeManager.InvalidSettlement.selector);
        manager.settle(id, ROOT_FAKE, 1, 20e6, bytes32(0)); // stake > principal

        vm.expectRevert(StudyStakeManager.InvalidSettlement.selector);
        manager.settle(id, bytes32(0), 1, 10e6, bytes32(0)); // zero root with completers

        vm.expectRevert(StudyStakeManager.InvalidSettlement.selector);
        manager.settle(id, ROOT_FAKE, 0, 10e6, bytes32(0)); // zero count, non-zero stake

        vm.expectRevert(StudyStakeManager.InvalidSettlement.selector);
        manager.settle(id, ROOT_FAKE, 1, 0, bytes32(0)); // non-zero count, zero stake
        vm.stopPrank();
    }

    // ---------------------------------------------------------------------
    // dispute and resolve_dispute
    // ---------------------------------------------------------------------

    function _settled_pair() internal returns (uint256 id) {
        id = _create();
        _join(id, alice, 10e6);
        _join(id, bob, 20e6);
        _to_end();
        _settle(id, _one(alice));
    }

    function test_dispute_happy_path() public {
        uint256 id = _settled_pair();
        vm.prank(alice);
        manager.dispute(id, keccak256("reason"));
        StudyStakeManager.Challenge memory c = manager.get_challenge(id);
        assertEq(uint8(c.status), uint8(StudyStakeManager.Status.Disputed));
        assertEq(c.disputed_at, block.timestamp);
        assertTrue(manager.has_disputed(id, alice));
    }

    function test_dispute_reverts() public {
        uint256 id = _create();
        _join(id, alice, 10e6);
        vm.expectRevert(StudyStakeManager.WrongStatus.selector);
        vm.prank(alice);
        manager.dispute(id, bytes32(0));

        _to_end();
        _settle(id, _one(alice));

        vm.expectRevert(StudyStakeManager.NotParticipant.selector);
        vm.prank(carol);
        manager.dispute(id, bytes32(0));

        vm.warp(block.timestamp + DISPUTE_WINDOW);
        vm.expectRevert(StudyStakeManager.TooLate.selector);
        vm.prank(alice);
        manager.dispute(id, bytes32(0));
    }

    function test_one_dispute_per_participant_and_resolve_reopens() public {
        uint256 id = _settled_pair();
        vm.prank(alice);
        manager.dispute(id, keccak256("r1"));

        // While Disputed, a second dispute is blocked by status.
        vm.expectRevert(StudyStakeManager.WrongStatus.selector);
        vm.prank(bob);
        manager.dispute(id, keccak256("r2"));

        vm.prank(guardian);
        manager.resolve_dispute(id, ROOT_FAKE, 1, 10e6, keccak256("e2"));
        StudyStakeManager.Challenge memory c = manager.get_challenge(id);
        assertEq(uint8(c.status), uint8(StudyStakeManager.Status.Settled));
        assertEq(c.settled_at, block.timestamp);

        // Alice already disputed once: blocked forever for this challenge.
        vm.expectRevert(StudyStakeManager.AlreadyDisputed.selector);
        vm.prank(alice);
        manager.dispute(id, keccak256("r3"));

        // Bob has not disputed yet, so the reopened window still accepts him.
        vm.prank(bob);
        manager.dispute(id, keccak256("r4"));
        assertTrue(manager.has_disputed(id, bob));
    }

    function test_resolve_dispute_reverts() public {
        uint256 id = _settled_pair();
        vm.expectRevert();
        vm.prank(alice);
        manager.resolve_dispute(id, ROOT_FAKE, 1, 10e6, bytes32(0));

        vm.expectRevert(StudyStakeManager.WrongStatus.selector);
        vm.prank(guardian);
        manager.resolve_dispute(id, ROOT_FAKE, 1, 10e6, bytes32(0));

        vm.prank(bob);
        manager.dispute(id, bytes32(0));
        vm.warp(block.timestamp + manager.DISPUTE_TIMEOUT());
        vm.expectRevert(StudyStakeManager.TooLate.selector);
        vm.prank(guardian);
        manager.resolve_dispute(id, ROOT_FAKE, 1, 10e6, bytes32(0));
    }

    // ---------------------------------------------------------------------
    // finalize
    // ---------------------------------------------------------------------

    function test_finalize_reverts() public {
        uint256 id = _create();
        vm.expectRevert(StudyStakeManager.WrongStatus.selector);
        manager.finalize(id);

        _join(id, alice, 10e6);
        _to_end();
        _settle(id, _one(alice));
        vm.expectRevert(StudyStakeManager.TooEarly.selector);
        manager.finalize(id);
    }

    function test_phase_of_progression() public {
        uint256 id = _create();
        _join(id, alice, 10e6);
        assertEq(uint8(manager.phase_of(id)), uint8(StudyStakeManager.Phase.Joining));
        vm.warp(join_deadline);
        assertEq(uint8(manager.phase_of(id)), uint8(StudyStakeManager.Phase.Running));
        vm.warp(end_time);
        assertEq(uint8(manager.phase_of(id)), uint8(StudyStakeManager.Phase.AwaitingSettle));
        vm.warp(end_time + SETTLE_GRACE);
        assertEq(uint8(manager.phase_of(id)), uint8(StudyStakeManager.Phase.Expirable));
    }

    function test_phase_of_settled_path() public {
        uint256 id = _settled_pair();
        assertEq(uint8(manager.phase_of(id)), uint8(StudyStakeManager.Phase.DisputeWindow));
        _after_dispute(id);
        assertEq(uint8(manager.phase_of(id)), uint8(StudyStakeManager.Phase.Finalizable));
    }

    function test_phase_of_unknown_reverts() public {
        vm.expectRevert(StudyStakeManager.WrongStatus.selector);
        manager.phase_of(42);
    }

    // ---------------------------------------------------------------------
    // expire
    // ---------------------------------------------------------------------

    function test_expire_from_open_pro_rata_and_bonus_refund() public {
        uint256 id = _create();
        _join(id, alice, 10e6);
        _join(id, bob, 30e6);
        _sponsor(id, sponsor, 4e6);
        _fund_yield(8e6, 1 hours);

        vm.expectRevert(StudyStakeManager.TooEarly.selector);
        manager.expire(id);

        vm.warp(uint256(end_time) + SETTLE_GRACE);
        uint256 treasury_before = usdc.balanceOf(treasury);
        manager.expire(id);

        StudyStakeManager.Challenge memory c = manager.get_challenge(id);
        assertEq(uint8(c.status), uint8(StudyStakeManager.Status.Expired));
        assertEq(c.reward_pot, 0);
        assertGe(c.final_assets, 40e6);
        assertEq(usdc.balanceOf(treasury), treasury_before);

        uint256 alice_before = usdc.balanceOf(alice);
        vm.prank(alice);
        manager.claim(id, true, new bytes32[](0));
        assertEq(usdc.balanceOf(alice) - alice_before, 10e6 * c.final_assets / 40e6);

        vm.prank(sponsor);
        manager.claim_sponsor_refund(id);
        assertEq(usdc.balanceOf(sponsor), 10_000e6 - 4e6 + 4e6);
    }

    function test_expire_from_disputed_reverts_wrong_status() public {
        uint256 id = _settled_pair();
        vm.prank(alice);
        manager.dispute(id, bytes32(0));

        vm.warp(block.timestamp + manager.DISPUTE_TIMEOUT());
        vm.expectRevert(StudyStakeManager.WrongStatus.selector);
        manager.expire(id);
    }

    /// @notice A disputed challenge whose guardian never resolved finalizes on the original settlement after timeout.
    function test_finalize_from_disputed_after_timeout() public {
        uint256 id = _create();
        _join(id, alice, 10e6);
        _join(id, bob, 20e6);
        _sponsor(id, sponsor, 4e6);
        _to_end();
        _settle(id, _one(alice));
        vm.prank(alice);
        manager.dispute(id, bytes32(0));
        uint256 disputed_at = manager.get_challenge(id).disputed_at;

        vm.warp(disputed_at + manager.DISPUTE_TIMEOUT() - 1);
        assertEq(uint8(manager.phase_of(id)), uint8(StudyStakeManager.Phase.Disputed));
        vm.expectRevert(StudyStakeManager.TooEarly.selector);
        manager.finalize(id);

        vm.warp(disputed_at + manager.DISPUTE_TIMEOUT());
        assertEq(uint8(manager.phase_of(id)), uint8(StudyStakeManager.Phase.Finalizable));
        manager.finalize(id);

        StudyStakeManager.Challenge memory c = manager.get_challenge(id);
        assertEq(uint8(c.status), uint8(StudyStakeManager.Status.Finalized));
        assertEq(c.completed_stake, 10e6);
        assertGe(c.reward_pot, 4e6);

        uint256 alice_before = usdc.balanceOf(alice);
        bytes32[] memory proof_alice = _proof(id, _one(alice), 0);
        vm.prank(alice);
        manager.claim(id, true, proof_alice);
        assertEq(usdc.balanceOf(alice) - alice_before, 10e6 + c.reward_pot);

        uint256 bob_before = usdc.balanceOf(bob);
        vm.prank(bob);
        manager.claim(id, false, new bytes32[](0));
        assertEq(usdc.balanceOf(bob) - bob_before, 20e6);
    }

    function test_expire_wrong_status_reverts() public {
        uint256 id = _settled_pair();
        _after_dispute(id);
        manager.finalize(id);
        vm.warp(block.timestamp + 365 days);
        vm.expectRevert(StudyStakeManager.WrongStatus.selector);
        manager.expire(id);
    }

    // ---------------------------------------------------------------------
    // claim: lifecycle and exact payouts
    // ---------------------------------------------------------------------

    function test_lifecycle_three_participants_exact_payouts() public {
        uint256 id = _create();
        _join(id, alice, 10e6);
        _join(id, bob, 20e6);
        _join(id, carol, 30e6);
        _sponsor(id, sponsor, 5e6);
        _fund_yield(6e6, 1 hours);

        address[] memory done = _two(alice, bob);
        _settle_and_finalize(id, done);

        StudyStakeManager.Challenge memory c = manager.get_challenge(id);
        assertFalse(c.loss);
        assertGe(c.final_assets, 60e6);
        assertEq(c.reward_pot, c.final_assets - 60e6 + 5e6);
        assertEq(uint8(c.status), uint8(StudyStakeManager.Status.Finalized));

        uint256 pot = c.reward_pot;
        uint256 alice_reward = pot * 10e6 / 30e6;
        uint256 bob_reward = pot * 20e6 / 30e6;

        uint256 bal = usdc.balanceOf(alice);
        bytes32[] memory proof_alice_0_2 = _proof(id, done, 0);
        vm.prank(alice);
        manager.claim(id, true, proof_alice_0_2);
        assertEq(usdc.balanceOf(alice) - bal, 10e6 + alice_reward);

        bal = usdc.balanceOf(bob);
        bytes32[] memory proof_bob_1_3 = _proof(id, done, 1);
        vm.prank(bob);
        manager.claim(id, true, proof_bob_1_3);
        assertEq(usdc.balanceOf(bob) - bal, 20e6 + bob_reward);

        bal = usdc.balanceOf(carol);
        vm.prank(carol);
        manager.claim(id, false, new bytes32[](0));
        assertEq(usdc.balanceOf(carol) - bal, 30e6);

        assertEq(manager.get_challenge(id).reward_paid, alice_reward + bob_reward);
        assertLe(manager.get_challenge(id).reward_paid, pot);

        // Badges: alice (completer) minted, carol (false) has none.
        assertGt(badge.badge_of(alice), 0);
        assertEq(badge.badge_of(carol), 0);
    }

    function test_claim_reverts() public {
        uint256 id = _create();
        _join(id, alice, 10e6);
        _join(id, bob, 20e6);

        vm.expectRevert(StudyStakeManager.NotParticipant.selector);
        vm.prank(carol);
        manager.claim(id, false, new bytes32[](0));

        vm.expectRevert(StudyStakeManager.WrongStatus.selector);
        vm.prank(alice);
        manager.claim(id, false, new bytes32[](0));

        address[] memory done = _two(alice, bob);
        _settle_and_finalize(id, done);

        vm.prank(alice);
        manager.claim(id, false, new bytes32[](0));
        vm.expectRevert(StudyStakeManager.AlreadyClaimed.selector);
        vm.prank(alice);
        manager.claim(id, false, new bytes32[](0));
    }

    function test_claim_invalid_proof_variants() public {
        uint256 id = _create();
        _join(id, alice, 10e6);
        _join(id, bob, 20e6);
        address[] memory done = _two(alice, bob);
        _settle_and_finalize(id, done);

        // Empty proof for a completer.
        vm.expectRevert(StudyStakeManager.InvalidProof.selector);
        vm.prank(alice);
        manager.claim(id, true, new bytes32[](0));

        // claim() rebuilds alice's leaf from msg.sender and her stored stake, so a forged leaf can only
        // be detected through the sibling. Each case below forges the sibling (bob's leaf) instead.

        // Sibling leaf bound to the wrong contract address.
        bytes32[] memory bad_contract = new bytes32[](1);
        bad_contract[0] = MerkleHelper.leaf_for(block.chainid, address(0xBEEF), id, bob, 20e6);
        vm.expectRevert(StudyStakeManager.InvalidProof.selector);
        vm.prank(alice);
        manager.claim(id, true, bad_contract);

        // Sibling leaf bound to the wrong challenge id.
        bytes32[] memory bad_id = new bytes32[](1);
        bad_id[0] = MerkleHelper.leaf_for(block.chainid, address(manager), id + 1, bob, 20e6);
        vm.expectRevert(StudyStakeManager.InvalidProof.selector);
        vm.prank(alice);
        manager.claim(id, true, bad_id);

        // Sibling leaf with a wrong stake.
        bytes32[] memory bad_stake = new bytes32[](1);
        bad_stake[0] = _leaf(id, bob, 21e6);
        vm.expectRevert(StudyStakeManager.InvalidProof.selector);
        vm.prank(alice);
        manager.claim(id, true, bad_stake);

        // Proof built on the original chain, replayed on another chain id.
        bytes32[] memory original_chain_proof = _proof(id, done, 0);
        uint256 original_chain = block.chainid;
        vm.chainId(original_chain + 1);
        vm.expectRevert(StudyStakeManager.InvalidProof.selector);
        vm.prank(alice);
        manager.claim(id, true, original_chain_proof);
        vm.chainId(original_chain);
    }

    function test_completed_false_needs_no_proof_and_no_reward() public {
        uint256 id = _create();
        _join(id, alice, 10e6);
        _join(id, bob, 20e6);
        _sponsor(id, sponsor, 3e6);
        address[] memory done = _one(bob);
        _settle_and_finalize(id, done);

        uint256 bal = usdc.balanceOf(alice);
        vm.prank(alice);
        manager.claim(id, false, new bytes32[](0));
        assertEq(usdc.balanceOf(alice) - bal, 10e6);
    }

    function test_claim_works_while_paused() public {
        uint256 id = _create();
        _join(id, alice, 10e6);
        _join(id, bob, 20e6);
        address[] memory done = _one(alice);
        _settle_and_finalize(id, done);

        vm.prank(guardian);
        manager.pause();
        uint256 bal = usdc.balanceOf(alice);
        bytes32[] memory proof_alice_0_4 = _proof(id, done, 0);
        vm.prank(alice);
        manager.claim(id, true, proof_alice_0_4);
        assertGt(usdc.balanceOf(alice), bal);
    }

    function test_claim_is_not_blocked_by_reverting_badge() public {
        manager = new StudyStakeManager(address(this), treasury, IStudyBadge(address(new RevertingBadge())));
        _wire(manager);

        uint256 id = _create();
        _join(id, alice, 10e6);
        _join(id, bob, 20e6);
        address[] memory done = _one(alice);
        _settle_and_finalize(id, done);

        uint256 bal = usdc.balanceOf(alice);
        bytes32[] memory proof_alice_0_5 = _proof(id, done, 0);
        vm.prank(alice);
        manager.claim(id, true, proof_alice_0_5);
        assertGe(usdc.balanceOf(alice) - bal, 10e6);
        assertEq(manager.claimed(id, alice), true);
    }

    /// @notice A claim forwarding too little gas must revert (no silent badge failure), and a retry with enough gas
    ///         records the streak reset.
    function test_claim_badge_gas_floor_and_streak_reset() public {
        uint256 win = _create();
        uint256 lose = _create();
        _join(win, alice, 10e6);
        _join(win, bob, 20e6);
        _join(lose, alice, 10e6);
        _join(lose, bob, 20e6);
        _to_end();
        _settle(win, _one(alice));
        _settle(lose, _none());
        vm.warp(uint256(end_time) + DISPUTE_WINDOW);
        manager.finalize(win);
        manager.finalize(lose);

        bytes32[] memory proof_win = _proof(win, _one(alice), 0);
        vm.prank(alice);
        manager.claim(win, true, proof_win);
        uint256 token = badge.badge_of(alice);
        assertGt(token, 0);
        (uint32 streak_after_win,,,,) = badge.stats_of(token);
        assertEq(streak_after_win, 1);

        vm.expectRevert(StudyStakeManager.InsufficientGas.selector);
        vm.prank(alice);
        manager.claim{gas: 400_000}(lose, false, new bytes32[](0));
        assertFalse(manager.claimed(lose, alice));
        (uint32 streak_still,,,,) = badge.stats_of(token);
        assertEq(streak_still, 1);

        vm.prank(alice);
        manager.claim{gas: 1_000_000}(lose, false, new bytes32[](0));
        assertTrue(manager.claimed(lose, alice));
        (uint32 streak_reset,,, uint32 failed,) = badge.stats_of(token);
        assertEq(streak_reset, 0);
        assertEq(failed, 1);
    }

    /// @notice A badge that burns all forwarded gas fails the badge call only. The claim still pays out.
    function test_claim_not_blocked_by_gas_burning_badge() public {
        manager = new StudyStakeManager(address(this), treasury, IStudyBadge(address(new GasBurningBadge())));
        _wire(manager);

        uint256 id = _create();
        _join(id, alice, 10e6);
        _join(id, bob, 20e6);
        address[] memory done = _one(alice);
        _settle_and_finalize(id, done);

        uint256 bal = usdc.balanceOf(alice);
        bytes32[] memory proof_alice = _proof(id, done, 0);
        vm.expectEmit(true, true, false, false, address(manager));
        emit StudyStakeManager.BadgeUpdateFailed(id, alice);
        vm.prank(alice);
        manager.claim(id, true, proof_alice);
        assertEq(usdc.balanceOf(alice) - bal, 10e6);
        assertTrue(manager.claimed(id, alice));
    }

    /// @notice Gas budget check: a first mint plus streak update fits well inside BADGE_GAS.
    function test_badge_record_result_gas_within_budget() public {
        StudyBadge fresh = new StudyBadge(address(this));
        fresh.grantRole(fresh.MANAGER_ROLE(), address(this));

        uint256 before = gasleft();
        fresh.record_result(alice, true);
        uint256 used = before - gasleft();
        emit log_named_uint("record_result first mint gas", used);
        assertLt(used, 200_000);
        assertGt(fresh.badge_of(alice), 0);

        fresh.record_result{gas: manager.BADGE_GAS()}(bob, true);
        assertGt(fresh.badge_of(bob), 0);
    }

    /// @notice Yield for a zero-completer challenge goes to the treasury only through collect_treasury.
    function test_collect_treasury_guards_and_ignores_pause() public {
        uint256 id = _create();
        _join(id, alice, 10e6);
        _fund_yield(3e6, 1 hours);
        _to_end();
        _settle(id, _none());

        vm.expectRevert(StudyStakeManager.WrongStatus.selector);
        manager.collect_treasury(id);

        vm.warp(uint256(end_time) + DISPUTE_WINDOW);
        manager.finalize(id);
        uint256 yield_amt = manager.get_challenge(id).final_assets - 10e6;

        vm.prank(guardian);
        manager.pause();
        manager.collect_treasury(id);
        assertEq(usdc.balanceOf(treasury), yield_amt);

        vm.expectRevert(StudyStakeManager.NothingToCollect.selector);
        manager.collect_treasury(id);
    }

    function test_collect_treasury_nothing_to_collect_without_yield() public {
        uint256 id = _create();
        _join(id, alice, 10e6);
        _settle_and_finalize(id, _none());

        assertEq(manager.get_challenge(id).treasury_due, 0);
        vm.expectRevert(StudyStakeManager.NothingToCollect.selector);
        manager.collect_treasury(id);
    }

    /// @notice A treasury that cannot receive the token must not block finalize or participant claims.
    function test_blacklisted_treasury_does_not_block_finalize_or_claims() public {
        address blocked = makeAddr("blocked_treasury");
        BlacklistToken bl = new BlacklistToken(blocked);
        MockYieldVault bl_vault = new MockYieldVault(IERC20(address(bl)));
        StudyStakeManager m = new StudyStakeManager(address(this), blocked, IStudyBadge(address(badge)));
        badge.grantRole(badge.MANAGER_ROLE(), address(m));
        _wire(m);
        m.set_allowed_token(address(bl), true);
        m.set_allowed_vault(address(bl_vault), true);

        bl.mint(alice, 10e6);
        bl.mint(bob, 20e6);
        bl.mint(address(this), 6e6);

        vm.prank(creator);
        uint256 id = m.create_challenge(
            IERC20(address(bl)),
            IERC4626(address(bl_vault)),
            MIN_STAKE,
            MAX_STAKE,
            join_deadline,
            end_time,
            SETTLE_GRACE,
            DISPUTE_WINDOW,
            keccak256("blacklist"),
            "ipfs://blacklist"
        );
        vm.startPrank(alice);
        bl.approve(address(m), 10e6);
        m.join(id, 10e6);
        vm.stopPrank();
        vm.startPrank(bob);
        bl.approve(address(m), 20e6);
        m.join(id, 20e6);
        vm.stopPrank();
        bl.approve(address(bl_vault), 6e6);
        bl_vault.fund_yield(6e6, 1 hours);

        _to_end();
        vm.prank(oracle);
        m.settle(id, bytes32(0), 0, 0, keccak256("evidence"));
        vm.warp(uint256(end_time) + DISPUTE_WINDOW);
        m.finalize(id);

        vm.prank(alice);
        m.claim(id, false, new bytes32[](0));
        assertEq(bl.balanceOf(alice), 10e6);
        vm.prank(bob);
        m.claim(id, false, new bytes32[](0));
        assertEq(bl.balanceOf(bob), 20e6);

        vm.expectRevert(BlacklistToken.Blacklisted.selector);
        m.collect_treasury(id);
        assertFalse(m.get_challenge(id).treasury_collected);
        assertEq(bl.balanceOf(blocked), 0);
    }

    function test_no_badge_update_on_expired_claim() public {
        uint256 id = _create();
        _join(id, alice, 10e6);
        vm.warp(uint256(end_time) + SETTLE_GRACE);
        manager.expire(id);
        vm.prank(alice);
        manager.claim(id, true, new bytes32[](0));
        assertEq(badge.badge_of(alice), 0);
    }

    /// @notice Oracle over-reports completed_stake. Rewards are capped by the pot and principal is untouched.
    function test_oracle_underreports_stake_rewards_capped_by_pot() public {
        uint256 id = _create();
        _join(id, alice, 10e6);
        _join(id, bob, 20e6);
        _sponsor(id, sponsor, 5e6);
        // Tree over alice's real leaf, but completed_stake is set to 1 (far too small).
        bytes32 root = MerkleHelper.root_of(_one_leaf(id, alice, 10e6));
        _to_end();
        vm.prank(oracle);
        manager.settle(id, root, 1, 1, keccak256("e"));
        _after_dispute(id);
        manager.finalize(id);

        uint256 pot = manager.get_challenge(id).reward_pot;
        uint256 bal = usdc.balanceOf(alice);
        vm.prank(alice);
        manager.claim(id, true, new bytes32[](0));
        assertEq(usdc.balanceOf(alice) - bal, 10e6 + pot);
        assertEq(manager.get_challenge(id).reward_paid, pot);
    }

    function _one_leaf(uint256 id, address who, uint128 stake) internal view returns (bytes32[] memory leaves) {
        leaves = new bytes32[](1);
        leaves[0] = MerkleHelper.leaf_for(block.chainid, address(manager), id, who, stake);
    }

    // ---------------------------------------------------------------------
    // Loss and zero-completer paths
    // ---------------------------------------------------------------------

    function test_vault_loss_pro_rata_and_rewards_from_bonus_only() public {
        uint256 id = _create();
        _join(id, alice, 10e6);
        _join(id, bob, 30e6);
        _sponsor(id, sponsor, 2e6);
        vault.loss_for_testing(20e6);

        address[] memory done = _one(alice);
        _settle_and_finalize(id, done);

        StudyStakeManager.Challenge memory c = manager.get_challenge(id);
        assertTrue(c.loss);
        assertLt(c.final_assets, 40e6);
        assertEq(c.reward_pot, 2e6);

        uint256 expected_principal = 10e6 * c.final_assets / 40e6;
        uint256 bal = usdc.balanceOf(alice);
        bytes32[] memory proof_alice_0_6 = _proof(id, done, 0);
        vm.prank(alice);
        manager.claim(id, true, proof_alice_0_6);
        assertEq(usdc.balanceOf(alice) - bal, expected_principal + 2e6);
    }

    /// @notice Zero completers: finalize only records the yield as treasury_due. collect_treasury pays it once.
    function test_zero_completers_yield_to_treasury_and_sponsor_refund() public {
        uint256 id = _create();
        _join(id, alice, 10e6);
        _join(id, bob, 20e6);
        _sponsor(id, sponsor, 4e6);
        _fund_yield(6e6, 1 hours);

        _settle_and_finalize(id, _none());

        StudyStakeManager.Challenge memory c = manager.get_challenge(id);
        assertEq(c.reward_pot, 0);
        uint256 yield_amt = c.final_assets - 30e6;
        assertEq(c.treasury_due, yield_amt);
        assertFalse(c.treasury_collected);
        assertEq(usdc.balanceOf(treasury), 0);

        manager.collect_treasury(id);
        assertEq(usdc.balanceOf(treasury), yield_amt);
        assertTrue(manager.get_challenge(id).treasury_collected);

        vm.expectRevert(StudyStakeManager.NothingToCollect.selector);
        manager.collect_treasury(id);
        assertEq(usdc.balanceOf(treasury), yield_amt);

        vm.prank(sponsor);
        manager.claim_sponsor_refund(id);
        assertEq(usdc.balanceOf(sponsor), 10_000e6);

        vm.expectRevert(StudyStakeManager.NothingToRefund.selector);
        vm.prank(sponsor);
        manager.claim_sponsor_refund(id);

        uint256 bal = usdc.balanceOf(alice);
        vm.prank(alice);
        manager.claim(id, false, new bytes32[](0));
        assertEq(usdc.balanceOf(alice) - bal, 10e6);
    }

    function test_sponsor_refund_reverts_when_finalized_with_completers_or_wrong_state() public {
        uint256 id = _create();
        _join(id, alice, 10e6);
        _sponsor(id, sponsor, 1e6);
        _settle_and_finalize(id, _one(alice));

        vm.expectRevert(StudyStakeManager.WrongStatus.selector);
        vm.prank(sponsor);
        manager.claim_sponsor_refund(id);
    }

    function test_expire_refunds_bonus_only_to_sponsor_who_funded() public {
        uint256 id = _create();
        _join(id, alice, 10e6);
        _sponsor(id, sponsor, 2e6);
        vm.warp(uint256(end_time) + SETTLE_GRACE);
        manager.expire(id);

        vm.expectRevert(StudyStakeManager.NothingToRefund.selector);
        vm.prank(carol);
        manager.claim_sponsor_refund(id);
    }

    // ---------------------------------------------------------------------
    // sweep_rewards
    // ---------------------------------------------------------------------

    function test_sweep_only_unclaimed_rewards_and_late_claimant_gets_principal() public {
        uint256 id = _create();
        _join(id, alice, 10e6);
        _join(id, bob, 10e6);
        _sponsor(id, sponsor, 4e6);
        _fund_yield(2e6, 1 hours);
        address[] memory done = _two(alice, bob);
        _settle_and_finalize(id, done);

        StudyStakeManager.Challenge memory c = manager.get_challenge(id);
        uint256 pot = c.reward_pot;
        uint256 alice_reward = pot * 10e6 / 20e6;

        bytes32[] memory proof_alice_0_7 = _proof(id, done, 0);
        vm.prank(alice);
        manager.claim(id, true, proof_alice_0_7);

        vm.expectRevert(StudyStakeManager.TooEarly.selector);
        manager.sweep_rewards(id);

        vm.warp(uint256(c.finalized_at) + manager.CLAIM_PERIOD() + 1);
        uint256 treasury_before = usdc.balanceOf(treasury);
        manager.sweep_rewards(id);
        assertEq(usdc.balanceOf(treasury) - treasury_before, pot - alice_reward);

        vm.expectRevert(StudyStakeManager.AlreadySwept.selector);
        manager.sweep_rewards(id);

        // Bob claims after the sweep: principal only, no reward.
        uint256 bob_before = usdc.balanceOf(bob);
        bytes32[] memory proof_bob_1_8 = _proof(id, done, 1);
        vm.prank(bob);
        manager.claim(id, true, proof_bob_1_8);
        assertEq(usdc.balanceOf(bob) - bob_before, 10e6);
    }

    function test_sweep_reverts_wrong_status() public {
        uint256 id = _create();
        vm.expectRevert(StudyStakeManager.WrongStatus.selector);
        manager.sweep_rewards(id);
    }

    // ---------------------------------------------------------------------
    // Vault donation attack at the manager level
    // ---------------------------------------------------------------------

    function test_first_depositor_donation_does_not_zero_out_join() public {
        address attacker = makeAddr("attacker");
        usdc.mint(attacker, 1_000e6);
        vm.startPrank(attacker);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(1, attacker);
        usdc.transfer(address(vault), 100e6);
        vm.stopPrank();

        uint256 id = _create();
        _join(id, alice, 10e6);
        assertGt(manager.get_challenge(id).total_shares, 0);

        address[] memory none_done = _none();
        _settle_and_finalize(id, none_done);
        uint256 bal = usdc.balanceOf(alice);
        vm.prank(alice);
        manager.claim(id, false, new bytes32[](0));
        // The donation dilutes the victim by a tiny rounding amount. Allow up to 0.1 percent.
        assertGe(usdc.balanceOf(alice) - bal, 10e6 * 999 / 1000);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function test_preview_claim_matches_claim() public {
        uint256 id = _create();
        _join(id, alice, 10e6);
        _join(id, bob, 20e6);
        address[] memory done = _one(alice);
        _settle_and_finalize(id, done);

        (uint256 principal_out, uint256 reward) = manager.preview_claim(id, alice, true);
        assertEq(principal_out, 10e6);
        uint256 bal = usdc.balanceOf(alice);
        bytes32[] memory proof_alice_0_9 = _proof(id, done, 0);
        vm.prank(alice);
        manager.claim(id, true, proof_alice_0_9);
        assertEq(usdc.balanceOf(alice) - bal, principal_out + reward);

        (uint256 p2, uint256 r2) = manager.preview_claim(id, alice, true);
        assertEq(p2, 0);
        assertEq(r2, 0);
    }
}
