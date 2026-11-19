// Merkle tree, proofs and evidence JSON. Pure, no I/O.
// Leaf encoding must match StudyStakeManager._leaf: keccak(keccak(abi.encode(chain, manager, id, account, stake))).

import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { getAddress, keccak256, toBytes } from 'viem';
import { canonical_json } from './canonical.ts';

export const LEAF_ENCODING = ['uint256', 'address', 'uint256', 'address', 'uint256'];
export const ZERO_ROOT = `0x${'0'.repeat(64)}` as const;

export type LeafValue = [string, string, string, string, string];

export interface LeafInput {
  chain_id: number;
  manager: string;
  challenge_id: number;
  account: string;
  stake: bigint;
}

export interface EvidenceEntry {
  account: string;
  stake: string;
  completed: boolean;
  reason: string;
  subject_hash?: string | null;
  activities?: { instance_id: number; submitted: boolean; time_finished: number | null }[];
}

export interface Evidence {
  version: 1 | 2;
  chain_id: number;
  manager: string;
  challenge_id: number;
  metadata_hash: string;
  generated_at: number;
  root: string;
  completed_count: number;
  completed_stake: string;
  entries: EvidenceEntry[];
  tree: unknown;
}

export function leaf_value(input: LeafInput): LeafValue {
  return [
    String(input.chain_id),
    getAddress(input.manager),
    String(input.challenge_id),
    getAddress(input.account),
    input.stake.toString(),
  ];
}

/** Returns null when there are no completers (root is then ZERO_ROOT). */
export function build_tree(leaves: LeafInput[]): StandardMerkleTree<LeafValue> | null {
  if (leaves.length === 0) return null;
  const values = leaves.map(leaf_value);
  return StandardMerkleTree.of<LeafValue>(values, LEAF_ENCODING);
}

export function root_of(tree: StandardMerkleTree<LeafValue> | null): string {
  return tree ? tree.root : ZERO_ROOT;
}

/** Hash of (site|userid), used for internal LMS account linking. */
export function subject_hash_of(site: string, userid: string | number): string {
  return keccak256(toBytes(`${site}|${userid}`));
}

export interface ProofResult {
  completed: boolean;
  stake: string;
  proof: string[];
}

/**
 * Builds {completed, stake, proof} for one account from the evidence JSON.
 * Returns null when the account is not in the evidence entries at all.
 */
export function proof_for_account(evidence: Evidence, account: string): ProofResult | null {
  const entry = evidence.entries.find((e) => e.account.toLowerCase() === account.toLowerCase());
  if (!entry) return null;
  if (!entry.completed || evidence.tree === null) {
    return { completed: false, stake: entry.stake, proof: [] };
  }
  const tree = StandardMerkleTree.load(evidence.tree as Parameters<typeof StandardMerkleTree.load>[0]) as unknown as StandardMerkleTree<LeafValue>;
  for (const [index, value] of tree.entries()) {
    if (String(value[3]).toLowerCase() === account.toLowerCase()) {
      return { completed: true, stake: entry.stake, proof: tree.getProof(index) };
    }
  }
  throw new Error('evidence tree does not contain a completed entry');
}

/**
 * Content-addressed key. The object name is its own evidence_hash, so an upload never overwrites what an
 * on-chain settle committed to.
 */
export function evidence_key(chain_id: number, challenge_id: number, evidence_hash: string): string {
  return `evidence/${chain_id}/${challenge_id}/${evidence_hash.toLowerCase()}.json`;
}

/** evidence_hash = keccak256(utf8(canonical_json(evidence))). */
export function evidence_hash_of(evidence: Evidence): `0x${string}` {
  return keccak256(toBytes(canonical_json(evidence)));
}
