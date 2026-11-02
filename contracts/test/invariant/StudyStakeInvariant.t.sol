// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {StudyStakeBase} from "../utils/StudyStakeBase.sol";
import {StudyStakeManager} from "../../src/StudyStakeManager.sol";
import {StudyStakeHandler} from "./StudyStakeHandler.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";

contract StudyStakeInvariantTest is StudyStakeBase {
    StudyStakeHandler internal handler;

    function setUp() public {
        _deploy_stack();
        manager.set_allowed_token(address(usdc), true);
        manager.set_allowed_vault(address(vault), true);

        address[] memory actors = new address[](3);
        actors[0] = alice;
        actors[1] = bob;
        actors[2] = carol;
        handler = new StudyStakeHandler(manager, usdc, IERC4626(address(vault)), actors, sponsor);

        manager.grantRole(manager.CREATOR_ROLE(), address(handler));
        manager.grantRole(manager.ORACLE_ROLE(), address(handler));
        manager.grantRole(manager.GUARDIAN_ROLE(), address(handler));

        // Pre-fund the handler's sponsor and actors are already funded by _deploy_stack.
        targetContract(address(handler));
    }

    /// @dev Invariant 1: for Open challenges, vault value of shares covers principal (up to 1 wei per join rounding).
    function invariant_open_challenges_backed_by_vault() public view {
        uint256[] memory ids = handler.challenge_ids();
        for (uint256 i = 0; i < ids.length; i++) {
            StudyStakeManager.Challenge memory c = manager.get_challenge(ids[i]);
            if (c.status == StudyStakeManager.Status.Open) {
                uint256 assets = vault.convertToAssets(c.total_shares);
                assertGe(assets + c.participant_count, c.total_principal);
            }
        }
    }

    /// @dev Invariant 2: paid out (principal + reward + sponsor refunds) <= principal + bonus. No yield is funded here.
    function invariant_paid_out_within_inflows() public view {
        uint256[] memory ids = handler.challenge_ids();
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 id = ids[i];
            StudyStakeManager.Challenge memory c = manager.get_challenge(id);
            uint256 out = uint256(c.principal_paid) + c.reward_paid + handler.ghost_refunds_of(id);
            assertLe(out, uint256(c.total_principal) + c.total_bonus);
        }
    }

    /// @dev Invariant 3: without vault loss, a finalized participant never receives less than their stake.
    function invariant_no_loss_claim_at_least_stake() public view {
        assertFalse(handler.ghost_under_stake());
    }

    /// @dev Invariant 4: rewards paid never exceed the reward pot.
    function invariant_reward_paid_le_pot() public view {
        uint256[] memory ids = handler.challenge_ids();
        for (uint256 i = 0; i < ids.length; i++) {
            StudyStakeManager.Challenge memory c = manager.get_challenge(ids[i]);
            assertLe(uint256(c.reward_paid), uint256(c.reward_pot));
        }
    }

    /// @dev Invariant 5: each (challenge, account) claims at most once. Claim paths are exercised while paused.
    function invariant_single_claim() public view {
        assertFalse(handler.ghost_double_claim());
    }

    /// @dev Invariant 6: after finalize or expire, the manager holds enough tokens for unclaimed principal,
    ///      unclaimed rewards and unrefunded sponsor bonus that is still owed.
    function invariant_manager_balance_covers_debts() public view {
        uint256[] memory ids = handler.challenge_ids();
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 id = ids[i];
            StudyStakeManager.Challenge memory c = manager.get_challenge(id);
            if (c.status != StudyStakeManager.Status.Finalized && c.status != StudyStakeManager.Status.Expired) {
                continue;
            }
            uint256 owed = 0;
            for (uint256 k = 0; k < 3; k++) {
                address who = _actor(k);
                if (manager.stake_of(id, who) > 0 && !manager.claimed(id, who)) {
                    (uint256 principal_out,) = manager.preview_claim(id, who, false);
                    owed += principal_out;
                }
            }
            if (c.status == StudyStakeManager.Status.Finalized && !c.rewards_swept) {
                owed += uint256(c.reward_pot) - c.reward_paid;
            }
            if (c.status == StudyStakeManager.Status.Expired || c.completed_stake == 0) {
                owed += uint256(c.total_bonus) - handler.ghost_refunds_of(id);
            }
            assertGe(usdc.balanceOf(address(manager)), owed);
        }
    }

    function _actor(uint256 k) internal view returns (address) {
        if (k == 0) return alice;
        if (k == 1) return bob;
        return carol;
    }
}
