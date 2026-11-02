import { describe, expect, it } from 'vitest';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { getAddress, keccak256, toBytes } from 'viem';
import { evidence_hash_of, verify_evidence, ZERO_ROOT, short_address } from '@/lib/verify';
import { canonical_json } from '@/lib/canonical';

const MANAGER = '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9';
const A = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const B = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';

function build_evidence() {
  const values = [
    ['31337', getAddress(MANAGER), '1', getAddress(A), '100000000'],
    ['31337', getAddress(MANAGER), '1', getAddress(B), '200000000'],
  ];
  const tree = StandardMerkleTree.of(values, ['uint256', 'address', 'uint256', 'address', 'uint256']);
  const doc = {
    version: 1,
    chain_id: 31337,
    manager: MANAGER,
    challenge_id: 1,
    metadata_hash: `0x${'11'.repeat(32)}`,
    generated_at: 1700000000,
    root: tree.root,
    completed_count: 2,
    completed_stake: '300000000',
    entries: [
      { account: A, stake: '100000000', completed: true, reason: 'ok', subject_hash: null, activities: [] },
      { account: B, stake: '200000000', completed: true, reason: 'ok', subject_hash: null, activities: [] },
    ],
    tree: tree.dump(),
  };
  return { doc, root: tree.root, hash: keccak256(toBytes(canonical_json(doc))) };
}

describe('verify_evidence', () => {
  it('passes when hash and root match on-chain values', () => {
    const { doc, root, hash } = build_evidence();
    const r = verify_evidence(doc, hash, root);
    expect(r.hash_ok).toBe(true);
    expect(r.root_ok).toBe(true);
    expect(r.tree_leaves).toBe(2);
  });

  it('fails the hash check when evidence is altered', () => {
    const { doc, root, hash } = build_evidence();
    const tampered = { ...doc, completed_count: 3 };
    const r = verify_evidence(tampered, hash, root);
    expect(r.hash_ok).toBe(false);
  });

  it('fails the root check when on-chain root differs', () => {
    const { doc, hash } = build_evidence();
    const r = verify_evidence(doc, hash, `0x${'22'.repeat(32)}`);
    expect(r.root_ok).toBe(false);
    expect(r.hash_ok).toBe(true);
  });

  it('accepts a zero root when there is no tree', () => {
    const doc = { version: 1, root: ZERO_ROOT, tree: null, entries: [] };
    const hash = evidence_hash_of(doc);
    const r = verify_evidence(doc, hash, ZERO_ROOT);
    expect(r.root_ok).toBe(true);
    expect(r.tree_leaves).toBe(0);
  });
});

describe('short_address', () => {
  it('shortens a checksummed address', () => {
    expect(short_address(A)).toBe('0x7099…79C8');
  });
});
