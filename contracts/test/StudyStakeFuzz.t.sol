// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {StudyStakeBase} from "./utils/StudyStakeBase.sol";
import {StudyStakeManager} from "../src/StudyStakeManager.sol";

contract StudyStakeFuzzTest is StudyStakeBase {
    function setUp() public {
        _deploy_stack();
    }

    /// @dev Completers chosen by bit mask over the three participants.
    function _completers(address[3] memory people, uint8 mask) internal pure returns (address[] memory out) {
        uint256 count = 0;
        for (uint256 i = 0; i < 3; i++) {
            if (((mask >> i) & 1) == 1) count++;
        }
        out = new address[](count);
        uint256 k = 0;
        for (uint256 i = 0; i < 3; i++) {
            if (((mask >> i) & 1) == 1) {
                out[k] = people[i];
                k++;
            }
        }
    }

    /// @dev Index of `who` in `list`, or type(uint256).max if absent.
    function _index_of(address[] memory list, address who) internal pure returns (uint256) {
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i] == who) return i;
        }
        return type(uint256).max;
    }

    /// @notice Random stakes, bonus, yield and completer subsets. Payouts never exceed inflows, every
    ///         participant gets at least their stake when there is no loss, and rewards are pro-rata.
    function testFuzz_payouts_bounded(
        uint128 s1,
        uint128 s2,
        uint128 s3,
        uint128 bonus_in,
        uint128 yield_in,
        uint8 mask
    ) public {
        uint128[3] memory stakes;
        stakes[0] = uint128(bound(s1, MIN_STAKE, MAX_STAKE));
        stakes[1] = uint128(bound(s2, MIN_STAKE, MAX_STAKE));
        stakes[2] = uint128(bound(s3, MIN_STAKE, MAX_STAKE));
        uint128 bonus = uint128(bound(bonus_in, 0, 50e6));
        uint128 yield_amt = uint128(bound(yield_in, 0, 50e6));

        address[3] memory people = [alice, bob, carol];
        uint256 id = _create();
        for (uint256 i = 0; i < 3; i++) {
            _join(id, people[i], stakes[i]);
        }
        if (bonus > 0) _sponsor(id, sponsor, bonus);
        if (yield_amt > 0) _fund_yield(yield_amt, 1 hours);

        address[] memory done = _completers(people, mask);
        _to_end();
        _settle(id, done);
        _after_dispute(id);
        manager.finalize(id);

        assertFalse(manager.get_challenge(id).loss);

        uint256 total_out = _claim_all(id, people, stakes, done);

        // Total paid out never exceeds principal + bonus + yield.
        uint256 inflows = uint256(stakes[0]) + stakes[1] + stakes[2] + bonus + yield_amt;
        assertLe(total_out, inflows);
        assertLe(manager.get_challenge(id).reward_paid, manager.get_challenge(id).reward_pot);
    }

    /// @dev Every participant claims. Checks principal is returned in full and rewards are pro-rata.
    function _claim_all(uint256 id, address[3] memory people, uint128[3] memory stakes, address[] memory done)
        internal
        returns (uint256 total_out)
    {
        StudyStakeManager.Challenge memory c = manager.get_challenge(id);
        for (uint256 i = 0; i < 3; i++) {
            uint256 index = _index_of(done, people[i]);
            bool completed = index != type(uint256).max;
            bytes32[] memory proof = completed ? _proof(id, done, index) : new bytes32[](0);

            uint256 before = usdc.balanceOf(people[i]);
            vm.prank(people[i]);
            manager.claim(id, completed, proof);
            uint256 got = usdc.balanceOf(people[i]) - before;
            total_out += got;

            // No loss: principal is always returned in full.
            assertGe(got, stakes[i]);
            if (completed) {
                // Pro-rata reward, floor rounding only.
                uint256 expected_reward = uint256(c.reward_pot) * stakes[i] / c.completed_stake;
                assertApproxEqAbs(got - stakes[i], expected_reward, 1);
            } else {
                assertEq(got, stakes[i]);
            }
        }
    }
}
