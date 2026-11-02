// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {TestUSDC} from "../../src/mocks/TestUSDC.sol";
import {MockYieldVault} from "../../src/mocks/MockYieldVault.sol";
import {StudyBadge} from "../../src/StudyBadge.sol";
import {StudyStakeManager} from "../../src/StudyStakeManager.sol";
import {IStudyBadge} from "../../src/interfaces/IStudyBadge.sol";
import {MerkleHelper} from "./MerkleHelper.sol";

/// @title StudyStakeBase
/// @notice Shared deployment and helper functions for StudyStake tests. The test contract is the admin,
///         the vault owner and the tUSDC owner.
abstract contract StudyStakeBase is Test {
    uint64 internal constant SETTLE_GRACE = 1 days;
    uint64 internal constant DISPUTE_WINDOW = 1 hours;
    uint128 internal constant MIN_STAKE = 1e6;
    uint128 internal constant MAX_STAKE = 100e6;

    TestUSDC internal usdc;
    MockYieldVault internal vault;
    StudyBadge internal badge;
    StudyStakeManager internal manager;

    address internal treasury = makeAddr("treasury");
    address internal oracle = makeAddr("oracle");
    address internal creator = makeAddr("creator");
    address internal guardian = makeAddr("guardian");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal sponsor = makeAddr("sponsor");

    uint64 internal join_deadline;
    uint64 internal end_time;

    /// @dev Deploys the full stack. Call from setUp.
    function _deploy_stack() internal {
        usdc = new TestUSDC();
        vault = new MockYieldVault(IERC20(address(usdc)));
        badge = new StudyBadge(address(this));
        manager = new StudyStakeManager(address(this), treasury, IStudyBadge(address(badge)));
        badge.grantRole(badge.MANAGER_ROLE(), address(manager));
        _wire(manager);
        join_deadline = uint64(block.timestamp + 1 days);
        end_time = uint64(join_deadline + 1 days);
        address[4] memory users = [alice, bob, carol, sponsor];
        for (uint256 i = 0; i < users.length; i++) {
            usdc.mint(users[i], 10_000e6);
        }
    }

    /// @dev Grants roles and allowlists for a manager instance.
    function _wire(StudyStakeManager m) internal {
        m.grantRole(m.CREATOR_ROLE(), creator);
        m.grantRole(m.ORACLE_ROLE(), oracle);
        m.grantRole(m.GUARDIAN_ROLE(), guardian);
        m.set_allowed_token(address(usdc), true);
        m.set_allowed_vault(address(vault), true);
    }

    /// @dev Calls create_challenge as `from` with raw parameters.
    function _create_raw(
        address from,
        address tok,
        address vlt,
        uint128 min_s,
        uint128 max_s,
        uint64 jd,
        uint64 et,
        uint64 sg,
        uint64 dw
    ) internal returns (uint256) {
        vm.prank(from);
        return manager.create_challenge(
            IERC20(tok), IERC4626(vlt), min_s, max_s, jd, et, sg, dw, keccak256("metadata"), "ipfs://metadata"
        );
    }

    /// @dev Standard valid challenge created by the creator.
    function _create() internal returns (uint256) {
        return _create_with(MIN_STAKE, MAX_STAKE);
    }

    function _create_with(uint128 min_s, uint128 max_s) internal returns (uint256) {
        return _create_raw(
            creator, address(usdc), address(vault), min_s, max_s, join_deadline, end_time, SETTLE_GRACE, DISPUTE_WINDOW
        );
    }

    function _join(uint256 id, address who, uint128 amount) internal {
        vm.startPrank(who);
        usdc.approve(address(manager), amount);
        manager.join(id, amount);
        vm.stopPrank();
    }

    function _sponsor(uint256 id, address who, uint128 amount) internal {
        vm.startPrank(who);
        usdc.approve(address(manager), amount);
        manager.sponsor(id, amount);
        vm.stopPrank();
    }

    function _fund_yield(uint256 amount, uint64 duration) internal {
        usdc.mint(address(this), amount);
        usdc.approve(address(vault), amount);
        vault.fund_yield(amount, duration);
    }

    function _leaf(uint256 id, address who, uint128 stake) internal view returns (bytes32) {
        return MerkleHelper.leaf_for(block.chainid, address(manager), id, who, stake);
    }

    /// @dev Leaves for `who` in order, using each participant's on-chain stake.
    function _leaves(uint256 id, address[] memory who) internal view returns (bytes32[] memory leaves) {
        leaves = new bytes32[](who.length);
        for (uint256 i = 0; i < who.length; i++) {
            leaves[i] = _leaf(id, who[i], manager.stake_of(id, who[i]));
        }
    }

    function _total_stake(uint256 id, address[] memory who) internal view returns (uint128 total) {
        for (uint256 i = 0; i < who.length; i++) {
            total += manager.stake_of(id, who[i]);
        }
    }

    /// @dev Settles with the given completers. Caller must warp into the settle window first.
    function _settle(uint256 id, address[] memory who) internal {
        bytes32 root = who.length == 0 ? bytes32(0) : MerkleHelper.root_of(_leaves(id, who));
        // Evaluate view calls before pranking: vm.prank applies to the next external call only.
        uint128 total = _total_stake(id, who);
        vm.prank(oracle);
        manager.settle(id, root, uint32(who.length), total, keccak256("evidence"));
    }

    /// @dev Proof for `who[index]` against the tree built from `who`.
    function _proof(uint256 id, address[] memory who, uint256 index) internal view returns (bytes32[] memory) {
        return MerkleHelper.proof_of(_leaves(id, who), index);
    }

    function _to_end() internal {
        vm.warp(end_time);
    }

    /// @dev Warps to the moment the dispute window closes.
    function _after_dispute(uint256 id) internal {
        StudyStakeManager.Challenge memory c = manager.get_challenge(id);
        vm.warp(uint256(c.settled_at) + c.dispute_window);
    }

    /// @dev Full path to Finalized with `who` as completers.
    function _settle_and_finalize(uint256 id, address[] memory who) internal {
        _to_end();
        _settle(id, who);
        _after_dispute(id);
        manager.finalize(id);
    }

    /// @dev Full path to Finalized with an explicit root and counts (used for crafted settlements).
    function _finalize_raw(uint256 id, bytes32 root, uint32 count, uint128 cs) internal {
        _to_end();
        vm.prank(oracle);
        manager.settle(id, root, count, cs, keccak256("evidence"));
        _after_dispute(id);
        manager.finalize(id);
    }

    function _one(address a) internal pure returns (address[] memory arr) {
        arr = new address[](1);
        arr[0] = a;
    }

    function _two(address a, address b) internal pure returns (address[] memory arr) {
        arr = new address[](2);
        arr[0] = a;
        arr[1] = b;
    }

    function _none() internal pure returns (address[] memory arr) {
        arr = new address[](0);
    }

    function _status(uint256 id) internal view returns (StudyStakeManager.Status) {
        return manager.get_challenge(id).status;
    }
}
