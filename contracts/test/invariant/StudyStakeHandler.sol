// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {TestUSDC} from "../../src/mocks/TestUSDC.sol";
import {StudyStakeManager} from "../../src/StudyStakeManager.sol";
import {MerkleHelper} from "../utils/MerkleHelper.sol";

/// @title StudyStakeHandler
/// @notice Random action driver for the invariant suite. Holds CREATOR, ORACLE and GUARDIAN roles and
///         records ghost accounting for the invariants.
contract StudyStakeHandler is Test {
    StudyStakeManager public manager;
    TestUSDC public usdc;
    IERC4626 public vault;
    address public sponsor_addr;

    address[] public actors;
    uint256[] public ids;

    mapping(uint256 => address[]) internal participants_of;
    mapping(uint256 => address[]) internal completers_of;
    mapping(uint256 => uint256) public ghost_refunds_of;
    mapping(uint256 => mapping(address => bool)) public ghost_claimed;

    bool public ghost_under_stake;
    bool public ghost_double_claim;

    constructor(
        StudyStakeManager manager_,
        TestUSDC usdc_,
        IERC4626 vault_,
        address[] memory actors_,
        address sponsor_
    ) {
        manager = manager_;
        usdc = usdc_;
        vault = vault_;
        sponsor_addr = sponsor_;
        for (uint256 i = 0; i < actors_.length; i++) {
            actors.push(actors_[i]);
        }
    }

    function challenge_ids() external view returns (uint256[] memory) {
        return ids;
    }

    /// @notice Creates a challenge with fixed-shape parameters.
    function create_challenge(uint256 seed) external {
        uint64 jd = uint64(block.timestamp + 1 days);
        uint64 et = uint64(jd + 1 days);
        uint256 id = manager.create_challenge(
            IERC20(address(usdc)),
            vault,
            1e6,
            100e6,
            jd,
            et,
            1 days,
            1 hours,
            keccak256(abi.encode(seed)),
            "ipfs://handler"
        );
        ids.push(id);
    }

    /// @notice Joins a random actor to a random challenge with a random stake.
    function join(uint256 seed, uint256 amount_seed) external {
        if (ids.length == 0) return;
        uint256 id = ids[seed % ids.length];
        address who = actors[(seed >> 16) % actors.length];
        uint128 amount = uint128(bound(amount_seed, 1e6, 100e6));

        vm.startPrank(who);
        usdc.approve(address(manager), amount);
        try manager.join(id, amount) {
            participants_of[id].push(who);
        } catch {}
        vm.stopPrank();
    }

    /// @notice Adds bonus to a random challenge.
    function sponsor(uint256 seed, uint256 amount_seed) external {
        if (ids.length == 0) return;
        uint256 id = ids[seed % ids.length];
        uint128 amount = uint128(bound(amount_seed, 1, 10e6));
        vm.startPrank(sponsor_addr);
        usdc.approve(address(manager), amount);
        try manager.sponsor(id, amount) {} catch {}
        vm.stopPrank();
    }

    /// @notice Settles a random challenge with a random prefix of its participants as completers.
    function settle(uint256 seed) external {
        if (ids.length == 0) return;
        uint256 id = ids[seed % ids.length];
        StudyStakeManager.Challenge memory c = manager.get_challenge(id);
        if (c.status != StudyStakeManager.Status.Open) return;
        if (block.timestamp < c.end_time) vm.warp(c.end_time);

        address[] storage parts = participants_of[id];
        uint256 k = parts.length == 0 ? 0 : (seed >> 32) % (parts.length + 1);
        address[] memory done = new address[](k);
        uint128 cs = 0;
        for (uint256 i = 0; i < k; i++) {
            done[i] = parts[i];
            cs += manager.stake_of(id, parts[i]);
        }
        bytes32 root = k == 0 ? bytes32(0) : MerkleHelper.root_of(_leaves(id, done));

        try manager.settle(id, root, uint32(k), cs, keccak256(abi.encode(seed))) {
            completers_of[id] = done;
        } catch {}
    }

    /// @notice Finalizes a settled challenge once its dispute window has passed.
    function finalize(uint256 seed) external {
        if (ids.length == 0) return;
        uint256 id = ids[seed % ids.length];
        StudyStakeManager.Challenge memory c = manager.get_challenge(id);
        if (c.status != StudyStakeManager.Status.Settled) return;
        if (block.timestamp < uint256(c.settled_at) + c.dispute_window) {
            vm.warp(uint256(c.settled_at) + c.dispute_window);
        }
        try manager.finalize(id) {} catch {}
    }

    /// @notice Expires a challenge (oracle never settled, or past grace).
    function expire(uint256 seed) external {
        if (ids.length == 0) return;
        uint256 id = ids[seed % ids.length];
        StudyStakeManager.Challenge memory c = manager.get_challenge(id);
        if (c.status == StudyStakeManager.Status.Open) {
            if (block.timestamp < uint256(c.end_time) + c.settle_grace) {
                vm.warp(uint256(c.end_time) + c.settle_grace);
            }
        }
        try manager.expire(id) {} catch {}
    }

    /// @notice Random participant claims on a random finished challenge.
    function claim(uint256 seed) external {
        if (ids.length == 0) return;
        uint256 id = ids[seed % ids.length];
        address[] storage parts = participants_of[id];
        if (parts.length == 0) return;
        address who = parts[(seed >> 16) % parts.length];

        StudyStakeManager.Challenge memory c = manager.get_challenge(id);
        if (c.status != StudyStakeManager.Status.Finalized && c.status != StudyStakeManager.Status.Expired) return;

        bool completed = ((seed >> 40) & 1) == 1;
        bytes32[] memory proof = new bytes32[](0);
        if (completed) {
            (bool found, uint256 index) = _find(completers_of[id], who);
            if (found) {
                proof = MerkleHelper.proof_of(_leaves(id, completers_of[id]), index);
            }
        }

        uint256 before = usdc.balanceOf(who);
        uint128 stake = manager.stake_of(id, who);
        vm.prank(who);
        try manager.claim(id, completed, proof) {
            if (ghost_claimed[id][who]) ghost_double_claim = true;
            ghost_claimed[id][who] = true;
            uint256 got = usdc.balanceOf(who) - before;
            if (c.status == StudyStakeManager.Status.Finalized && !c.loss && got < stake) {
                ghost_under_stake = true;
            }
        } catch {}
    }

    /// @notice Sponsor refund attempt, records refunded amounts.
    function claim_sponsor_refund(uint256 seed) external {
        if (ids.length == 0) return;
        uint256 id = ids[seed % ids.length];
        uint256 amount = manager.sponsor_amount_of(id, sponsor_addr);
        vm.prank(sponsor_addr);
        try manager.claim_sponsor_refund(id) {
            ghost_refunds_of[id] += amount;
        } catch {}
    }

    /// @notice Jumps past the claim period and sweeps rewards.
    function sweep(uint256 seed) external {
        if (ids.length == 0) return;
        uint256 id = ids[seed % ids.length];
        if (seed % 4 == 0) vm.warp(block.timestamp + 181 days);
        try manager.sweep_rewards(id) {} catch {}
    }

    /// @notice Pause and unpause through the guardian. Claims and finalize must keep working.
    function toggle_pause(uint256 seed) external {
        if (manager.paused()) {
            manager.unpause();
        } else if (seed % 2 == 0) {
            manager.pause();
        }
    }

    function _find(address[] storage list, address who) internal view returns (bool, uint256) {
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i] == who) return (true, i);
        }
        return (false, 0);
    }

    function _leaves(uint256 id, address[] memory who) internal view returns (bytes32[] memory leaves) {
        leaves = new bytes32[](who.length);
        for (uint256 i = 0; i < who.length; i++) {
            leaves[i] = MerkleHelper.leaf_for(block.chainid, address(manager), id, who[i], manager.stake_of(id, who[i]));
        }
    }
}
