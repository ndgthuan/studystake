// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {MerkleHelper} from "./MerkleHelper.sol";

contract MerkleHelperTest is Test {
    function test_proofs_verify_with_openzeppelin_for_1_to_16_leaves() public pure {
        for (uint256 n = 1; n <= 16; n++) {
            bytes32[] memory leaves = new bytes32[](n);
            for (uint256 i = 0; i < n; i++) {
                leaves[i] = keccak256(abi.encode("leaf", n, i));
            }
            bytes32 root = MerkleHelper.root_of(leaves);
            for (uint256 i = 0; i < n; i++) {
                bytes32[] memory proof = MerkleHelper.proof_of(leaves, i);
                assertTrue(MerkleProof.verify(proof, root, leaves[i]), "valid proof rejected");
                assertFalse(
                    MerkleProof.verify(proof, root, keccak256(abi.encode("other", n, i))), "foreign leaf accepted"
                );
            }
        }
    }

    function test_single_leaf_root_is_leaf_and_proof_empty() public pure {
        bytes32[] memory leaves = new bytes32[](1);
        leaves[0] = keccak256("only");
        assertEq(MerkleHelper.root_of(leaves), leaves[0]);
        assertEq(MerkleHelper.proof_of(leaves, 0).length, 0);
    }

    function test_hash_pair_is_commutative() public pure {
        bytes32 a = keccak256("a");
        bytes32 b = keccak256("b");
        assertEq(MerkleHelper.hash_pair(a, b), MerkleHelper.hash_pair(b, a));
    }
}
