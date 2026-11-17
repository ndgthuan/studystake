// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {StudyBadge} from "../../src/StudyBadge.sol";
import {StudyStakeManager} from "../../src/StudyStakeManager.sol";
import {IStudyBadge} from "../../src/interfaces/IStudyBadge.sol";
import {AaveV3Adapter} from "../../src/adapters/AaveV3Adapter.sol";
import {MerkleHelper} from "../utils/MerkleHelper.sol";

contract AaveV3AdapterForkTest is Test {
    IERC20 internal constant USDC = IERC20(0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E);
    address internal constant STATA_USDC = 0xe1bFC96d95BAdCB10Ff013Cb0C9C6c737ca07009;
    uint128 internal constant STAKE = 100e6;

    function test_joins_and_claims_principal_plus_aave_yield() external {
        vm.skip(block.chainid != 43114);
        AaveV3Adapter adapter = new AaveV3Adapter();
        IERC4626 vault = adapter.vault_for(address(USDC));
        assertEq(address(vault), STATA_USDC);

        StudyBadge badge = new StudyBadge(address(this));
        StudyStakeManager manager =
            new StudyStakeManager(address(this), makeAddr("treasury"), IStudyBadge(address(badge)));
        badge.grantRole(badge.MANAGER_ROLE(), address(manager));
        manager.grantRole(manager.CREATOR_ROLE(), address(this));
        manager.grantRole(manager.ORACLE_ROLE(), address(this));
        manager.set_allowed_token(address(USDC), true);
        manager.set_allowed_vault(address(vault), true);

        uint64 deadline = uint64(block.timestamp + 1 days);
        uint64 end_time = deadline + 2 days;
        uint256 id = manager.create_challenge(
            USDC, vault, 1e6, STAKE, deadline, end_time, 1 days, 5 minutes, keccak256("metadata"), "ipfs://metadata"
        );
        address student = makeAddr("student");
        deal(address(USDC), student, STAKE);
        vm.startPrank(student);
        assertTrue(USDC.approve(address(manager), STAKE));
        manager.join(id, STAKE);
        vm.stopPrank();
        assertGt(vault.balanceOf(address(manager)), 0);

        vm.warp(end_time + 1);
        bytes32 root = MerkleHelper.leaf_for(block.chainid, address(manager), id, student, STAKE);
        manager.settle(id, root, 1, STAKE, keccak256("evidence"));
        vm.warp(end_time + 5 minutes + 2);
        manager.finalize(id);
        assertEq(vault.balanceOf(address(manager)), 0);
        (, uint256 reward) = manager.preview_claim(id, student, true);
        assertGt(reward, 0);

        vm.prank(student);
        manager.claim(id, true, new bytes32[](0));
        assertEq(USDC.balanceOf(student), uint256(STAKE) + reward);
        assertEq(badge.balanceOf(student), 1);
    }
}
