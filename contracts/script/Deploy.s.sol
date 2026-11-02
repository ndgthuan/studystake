// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TestUSDC} from "../src/mocks/TestUSDC.sol";
import {MockYieldVault} from "../src/mocks/MockYieldVault.sol";
import {StudyBadge} from "../src/StudyBadge.sol";
import {StudyStakeManager} from "../src/StudyStakeManager.sol";
import {IStudyBadge} from "../src/interfaces/IStudyBadge.sol";

/// @title Deploy
/// @notice Deploys the StudyStake contracts and writes addresses to deployments/<chainid>.json.
/// @dev Env: PRIVATE_KEY (deployer = admin), ORACLE_ADDRESS, TREASURY_ADDRESS,
///      optional USE_CIRCLE_USDC (bool, default false), CIRCLE_USDC (default Fuji Circle USDC).
contract Deploy is Script {
    address public constant DEFAULT_CIRCLE_USDC = 0x5425890298aed601595a70AB815c96711a31Bc65;

    /// @notice Entry point for `forge script`.
    function run() external {
        uint256 deployer_key = vm.envUint("PRIVATE_KEY");
        address oracle = vm.envAddress("ORACLE_ADDRESS");
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        bool use_circle = vm.envOr("USE_CIRCLE_USDC", false);
        address circle_usdc = vm.envOr("CIRCLE_USDC", DEFAULT_CIRCLE_USDC);

        vm.startBroadcast(deployer_key);
        address deployer = vm.addr(deployer_key);

        TestUSDC usdc = new TestUSDC();
        MockYieldVault usdc_vault = new MockYieldVault(IERC20(address(usdc)));
        StudyBadge badge = new StudyBadge(deployer);
        StudyStakeManager manager = new StudyStakeManager(deployer, treasury, IStudyBadge(address(badge)));

        address circle_vault = address(0);
        if (use_circle) {
            circle_vault = address(new MockYieldVault(IERC20(circle_usdc)));
        }

        _wire(manager, badge, deployer, oracle, address(usdc), address(usdc_vault));
        if (use_circle) {
            manager.set_allowed_token(circle_usdc, true);
            manager.set_allowed_vault(circle_vault, true);
        }
        vm.stopBroadcast();

        _write_json(
            oracle, treasury, address(usdc), address(usdc_vault), address(badge), address(manager), circle_vault
        );
    }

    /// @dev Grants roles and allowlists the tUSDC token and vault.
    function _wire(
        StudyStakeManager manager,
        StudyBadge badge,
        address deployer,
        address oracle,
        address usdc,
        address usdc_vault
    ) internal {
        badge.grantRole(badge.MANAGER_ROLE(), address(manager));
        manager.grantRole(manager.ORACLE_ROLE(), oracle);
        manager.grantRole(manager.CREATOR_ROLE(), deployer);
        manager.grantRole(manager.GUARDIAN_ROLE(), deployer);
        manager.set_allowed_token(usdc, true);
        manager.set_allowed_vault(usdc_vault, true);
    }

    /// @dev Writes the deployment addresses to ./deployments/<chainid>.json.
    function _write_json(
        address oracle,
        address treasury,
        address usdc,
        address usdc_vault,
        address badge,
        address manager,
        address circle_vault
    ) internal {
        string memory key = "deployment";
        vm.serializeAddress(key, "oracle", oracle);
        vm.serializeAddress(key, "treasury", treasury);
        vm.serializeAddress(key, "tusdc", usdc);
        vm.serializeAddress(key, "tusdc_vault", usdc_vault);
        vm.serializeAddress(key, "badge", badge);
        vm.serializeAddress(key, "manager", manager);
        string memory out = vm.serializeAddress(key, "circle_usdc_vault", circle_vault);

        vm.createDir("./deployments", true);
        string memory path = string.concat("./deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(out, path);
    }
}
