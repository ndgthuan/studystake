// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MockYieldVault
/// @notice ERC-4626 vault that simulates yield with a linear drip. TESTNET ONLY.
/// @dev Owner funds a yield amount which is released linearly over `duration`.
///      Unreleased yield is excluded from totalAssets. `loss_for_testing` simulates a loss.
contract MockYieldVault is ERC4626, Ownable {
    using SafeERC20 for IERC20;

    /// @notice Total amount of the current drip, including carry-over from the previous drip.
    uint256 public drip_total;
    /// @notice Start timestamp of the current drip.
    uint64 public drip_start;
    /// @notice End timestamp of the current drip.
    uint64 public drip_end;

    error ZeroDuration();

    event YieldFunded(uint256 amount, uint64 drip_end);

    constructor(IERC20 asset_) ERC4626(asset_) ERC20("Mock Yield Vault", "mYV") Ownable(msg.sender) {}

    /// @notice Owner deposits yield. Unreleased yield from the previous drip is carried over.
    /// @param amount Amount of the underlying asset to add as yield.
    /// @param duration Drip duration in seconds, must be > 0.
    function fund_yield(uint256 amount, uint64 duration) external onlyOwner {
        if (duration == 0) revert ZeroDuration();
        uint256 carried = unreleased();
        uint256 new_total = carried + amount;
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), amount);
        drip_total = new_total;
        drip_start = uint64(block.timestamp);
        drip_end = uint64(block.timestamp) + duration;
        emit YieldFunded(amount, drip_end);
    }

    /// @notice Yield not yet released by the current drip.
    function unreleased() public view returns (uint256) {
        if (block.timestamp >= drip_end) {
            return 0;
        }
        return drip_total * (uint256(drip_end) - block.timestamp) / uint256(drip_end - drip_start);
    }

    /// @notice Assets excluding unreleased yield. Floored at zero if the balance drops below it.
    function totalAssets() public view override returns (uint256) {
        uint256 balance = IERC20(asset()).balanceOf(address(this));
        uint256 locked_amount = unreleased();
        return balance > locked_amount ? balance - locked_amount : 0;
    }

    /// @notice Simulates a vault loss by sending `amount` of the asset to the owner. CHI CHO TESTNET (TESTNET ONLY).
    /// @param amount Amount of the asset to remove from the vault.
    function loss_for_testing(uint256 amount) external onlyOwner {
        IERC20(asset()).safeTransfer(owner(), amount);
    }

    /// @dev Virtual shares offset of 1e6 to mitigate the first-depositor inflation attack.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }
}
