// Browser-side evidence verification. Recomputes keccak(canonical_json(evidence)) and the Merkle root,
// then compares them with the on-chain values. Pure functions (no network); callers supply the data.
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { getAddress, keccak256, toBytes } from 'viem';
import { canonical_json } from './canonical';

export const LEAF_ENCODING = ['uint256', 'address', 'uint256', 'address', 'uint256'];
export const ZERO_ROOT = `0x${'0'.repeat(64)}`;

export interface EvidenceEntry {
  account: string;
  stake: string;
  completed: boolean;
  reason: string;
  subject_hash?: string | null;
  activities?: { instance_id: number; submitted: boolean; time_finished: number | null }[];
}

export interface Evidence {
  version: number;
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

export interface VerifyResult {
  hash_ok: boolean;
  root_ok: boolean;
  computed_hash: `0x${string}` | null;
  computed_root: string | null;
  tree_leaves: number;
  error: string | null;
}

/** keccak256 of the canonical JSON of an evidence document. */
export function evidence_hash_of(evidence: unknown): `0x${string}` {
  return keccak256(toBytes(canonical_json(evidence)));
}

/** Recomputes the root from `tree` (a StandardMerkleTree dump). Returns ZERO_ROOT when there is no tree. */
export function root_from_tree(tree: unknown): { root: string; leaves: number } {
  if (tree === null || tree === undefined) return { root: ZERO_ROOT, leaves: 0 };
  const loaded = StandardMerkleTree.load(tree as Parameters<typeof StandardMerkleTree.load>[0]);
  let leaves = 0;
  leaves = Array.from(loaded.entries()).length;
  return { root: loaded.root, leaves };
}

/**
 * Verifies evidence against the on-chain commitment.
 * - keccak(canonical(evidence)) must equal `onchain_evidence_hash`.
 * - The tree root must equal `onchain_root`.
 */
export function verify_evidence(
  evidence: unknown,
  onchain_evidence_hash: string,
  onchain_root: string,
): VerifyResult {
  try {
    const computed_hash = evidence_hash_of(evidence);
    const doc = evidence as Partial<Evidence>;
    const { root, leaves } = root_from_tree(doc.tree);
    return {
      hash_ok: computed_hash.toLowerCase() === onchain_evidence_hash.toLowerCase(),
      root_ok: root.toLowerCase() === onchain_root.toLowerCase(),
      computed_hash,
      computed_root: root,
      tree_leaves: leaves,
      error: null,
    };
  } catch (err) {
    return {
      hash_ok: false,
      root_ok: false,
      computed_hash: null,
      computed_root: null,
      tree_leaves: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Short wallet form for display, e.g. 0x1234…abcd. */
export function short_address(addr: string): string {
  try {
    const a = getAddress(addr);
    return `${a.slice(0, 6)}…${a.slice(-4)}`;
  } catch {
    return addr;
  }
}
