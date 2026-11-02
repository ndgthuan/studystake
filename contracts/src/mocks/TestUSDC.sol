// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title TestUSDC
/// @notice Test-only USDC-like token (6 decimals, EIP-2612 permit) with a daily faucet. NOT for mainnet.
contract TestUSDC is ERC20, ERC20Permit, Ownable {
    uint256 public constant FAUCET_AMOUNT = 1_000e6;
    uint256 public constant FAUCET_COOLDOWN = 1 days;

    /// @notice Timestamp of the last faucet claim per address (0 = never claimed).
    mapping(address => uint256) public last_faucet;

    error FaucetCooldown(uint256 next_time);

    constructor() ERC20("Test USDC", "tUSDC") ERC20Permit("Test USDC") Ownable(msg.sender) {}

    /// @notice Returns 6 decimals, like USDC.
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Mints 1000 tUSDC to the caller. Each address may call once every 24 hours.
    function faucet() external {
        uint256 last = last_faucet[msg.sender];
        if (last != 0 && block.timestamp < last + FAUCET_COOLDOWN) {
            revert FaucetCooldown(last + FAUCET_COOLDOWN);
        }
        last_faucet[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
    }

    /// @notice Owner-only mint, used by tests and demos.
    /// @param to Recipient.
    /// @param amount Amount in base units (6 decimals).
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
