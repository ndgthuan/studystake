// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";

interface IStataTokenFactory {
    function getStataToken(address underlying) external view returns (address);
}

/// @notice Resolves an Avalanche Aave V3 reserve to its official StataToken ERC-4626 vault.
/// @dev Pass the returned vault to StudyStakeManager. The adapter never takes custody or adds a second layer of shares.
contract AaveV3Adapter {
    uint256 internal constant AVALANCHE_C_CHAIN = 43114;
    // https://github.com/aave-dao/aave-address-book/blob/main/src/AaveV3Avalanche.sol
    IStataTokenFactory internal constant FACTORY = IStataTokenFactory(0xC2E7A608d868817dd58438913Ed72955a0567561);

    error UnsupportedChain(uint256 chainId);
    error VaultUnavailable(address asset);
    error VaultAssetMismatch(address expected, address actual);

    function vault_for(address asset) external view returns (IERC4626 vault) {
        if (block.chainid != AVALANCHE_C_CHAIN) revert UnsupportedChain(block.chainid);
        vault = IERC4626(FACTORY.getStataToken(asset));
        if (address(vault).code.length == 0) revert VaultUnavailable(asset);
        address underlying = vault.asset();
        if (underlying != asset) revert VaultAssetMismatch(asset, underlying);
    }
}
