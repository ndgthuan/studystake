// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title MerkleHelper
/// @notice Test helper that builds OpenZeppelin-compatible Merkle trees (commutative keccak pairs).
/// @dev Odd nodes at a level are promoted unchanged (no self-pairing). Supports 1..16 leaves.
library MerkleHelper {
    /// @notice Commutative keccak of two nodes, identical to OZ MerkleProof._hashPair.
    function hash_pair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    /// @notice Double-hashed leaf, identical to StudyStakeManager._leaf.
    function leaf_for(uint256 chain_id, address manager, uint256 id, address account, uint128 stake)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(bytes.concat(keccak256(abi.encode(chain_id, manager, id, account, uint256(stake)))));
    }

    /// @notice Builds the next tree level. An odd last node is promoted.
    function next_level(bytes32[] memory level) internal pure returns (bytes32[] memory next) {
        uint256 n = (level.length + 1) / 2;
        next = new bytes32[](n);
        for (uint256 i = 0; i < n; i++) {
            uint256 left = 2 * i;
            uint256 right = left + 1;
            next[i] = right < level.length ? hash_pair(level[left], level[right]) : level[left];
        }
    }

    /// @notice Root of a tree over `leaves` (1..16 leaves).
    function root_of(bytes32[] memory leaves) internal pure returns (bytes32) {
        require(leaves.length > 0 && leaves.length <= 16, "MerkleHelper: size");
        bytes32[] memory level = leaves;
        while (level.length > 1) {
            level = next_level(level);
        }
        return level[0];
    }

    /// @notice Proof for `leaves[index]`. Levels where the node is promoted add no sibling.
    function proof_of(bytes32[] memory leaves, uint256 index) internal pure returns (bytes32[] memory) {
        require(index < leaves.length, "MerkleHelper: index");
        bytes32[] memory buf = new bytes32[](32);
        uint256 count = 0;
        bytes32[] memory level = leaves;
        uint256 idx = index;
        while (level.length > 1) {
            uint256 sibling = idx ^ 1;
            if (sibling < level.length) {
                buf[count] = level[sibling];
                count++;
            }
            level = next_level(level);
            idx = idx / 2;
        }
        bytes32[] memory proof = new bytes32[](count);
        for (uint256 i = 0; i < count; i++) {
            proof[i] = buf[i];
        }
        return proof;
    }
}
