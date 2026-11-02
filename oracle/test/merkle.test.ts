import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, keccak256, concat } from 'viem';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { build_tree, leaf_value, proof_for_account, root_of, ZERO_ROOT, type Evidence } from '../src/merkle.ts';

const MANAGER = '0x' + 'ab'.repeat(20);
const A = '0x' + '11'.repeat(20);
const B = '0x' + '22'.repeat(20);
const C = '0x' + '33'.repeat(20);

/** Mirrors StudyStakeManager._leaf: keccak(bytes.concat(keccak(abi.encode(chain, manager, id, account, stake)))). */
function contract_leaf(chain_id: number, manager: string, id: number, account: string, stake: bigint): `0x${string}` {
  const inner = keccak256(
    encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'address' }, { type: 'uint256' }, { type: 'address' }, { type: 'uint256' }],
      [BigInt(chain_id), manager as `0x${string}`, BigInt(id), account as `0x${string}`, stake],
    ),
  );
  return keccak256(concat([inner]));
}

describe('merkle compatibility with StudyStakeManager._leaf', () => {
  it('OZ StandardMerkleTree leaf hash equals the contract double-hash leaf', () => {
    const v = leaf_value({ chain_id: 31337, manager: MANAGER, challenge_id: 7, account: A, stake: 1_000_000n });
    const tree = StandardMerkleTree.of([v], ['uint256', 'address', 'uint256', 'address', 'uint256']);
    const oz_leaf = tree.leafHash(v);
    expect(oz_leaf).toBe(contract_leaf(31337, MANAGER, 7, A, 1_000_000n));
    expect(tree.root).toBe(oz_leaf);
  });

  it('every proof from the built tree verifies against the contract leaf and root', () => {
    const leaves = [
      { chain_id: 43113, manager: MANAGER, challenge_id: 3, account: A, stake: 500n },
      { chain_id: 43113, manager: MANAGER, challenge_id: 3, account: B, stake: 700n },
      { chain_id: 43113, manager: MANAGER, challenge_id: 3, account: C, stake: 900n },
    ];
    const tree = build_tree(leaves)!;
    for (const l of leaves) {
      const idx = Array.from(tree.entries()).find(([, v]) => String(v[3]).toLowerCase() === l.account.toLowerCase())![0];
      const proof = tree.getProof(idx);
      let hash = contract_leaf(l.chain_id, l.manager, l.challenge_id, l.account, l.stake);
      for (const sib of proof) {
        const [lo, hi] = hash.toLowerCase() < sib.toLowerCase() ? [hash, sib] : [sib, hash];
        hash = keccak256(concat([lo as `0x${string}`, hi as `0x${string}`]));
      }
      expect(hash).toBe(tree.root);
    }
  });

  it('no completers gives the zero root', () => {
    expect(build_tree([])).toBeNull();
    expect(root_of(null)).toBe(ZERO_ROOT);
  });

  it('proof_for_account returns completed=false and empty proof for non-completers', () => {
    const evidence = {
      version: 1,
      chain_id: 31337,
      manager: MANAGER,
      challenge_id: 1,
      metadata_hash: '0x' + '0'.repeat(64),
      generated_at: 0,
      root: ZERO_ROOT,
      completed_count: 0,
      completed_stake: '0',
      entries: [{ account: A, stake: '100', completed: false, reason: 'missing', subject_hash: null, activities: [] }],
      tree: null,
    } as Evidence;
    expect(proof_for_account(evidence, A)).toEqual({ completed: false, stake: '100', proof: [] });
    expect(proof_for_account(evidence, B)).toBeNull();
  });
});
