// Content-addressed evidence. The on-chain evidence_hash decides which object is served, verified and accepted by upload.
import { keccak256, toBytes } from 'viem';
import { canonical_json } from './canonical.ts';
import { STATUS, type ChallengeRow } from './chain.ts';
import { ApiError } from './http.ts';
import { evidence_key, proof_for_account, type Evidence, type ProofResult } from './merkle.ts';
import { get_text, type R2Like } from './store.ts';

export type ProofLookup = { kind: 'no_evidence' } | { kind: 'no_account' } | { kind: 'ok'; proof: ProofResult };

/** Proof for one account, read from the evidence object committed on chain (never from a rebuilt tree). */
export async function committed_proof(r2: R2Like, chain_id: number, ch: ChallengeRow, account: string): Promise<ProofLookup> {
  const found = await load_committed_evidence(r2, chain_id, ch);
  if (found === null) return { kind: 'no_evidence' };
  const proof = proof_for_account(found.evidence, account);
  if (proof === null) return { kind: 'no_account' };
  return { kind: 'ok', proof };
}

/** Statuses in which settle has committed an evidence_hash on chain. */
export const COMMITTED_STATUSES: readonly number[] = [STATUS.Settled, STATUS.Disputed, STATUS.Finalized];

export function is_committed(ch: ChallengeRow): boolean {
  return COMMITTED_STATUSES.includes(ch.status);
}

/** keccak256 of the canonical JSON, or null when the value cannot be canonicalized (e.g. a non-finite number). */
export function hash_canonical(value: unknown): { canonical: string; hash: `0x${string}` } | null {
  try {
    const canonical = canonical_json(value);
    return { canonical, hash: keccak256(toBytes(canonical)) };
  } catch {
    return null;
  }
}

export type UploadCheck = { ok: true; canonical: string } | { ok: false; reason: string };

/**
 * Accepts an uploaded evidence document only when it is exactly the object the chain committed to:
 * keccak(canonical) equals the on-chain evidence_hash, and chain_id, manager, challenge_id and root match.
 */
export function check_evidence_upload(raw: unknown, ch: ChallengeRow, cfg: { chain_id: number; manager: string }): UploadCheck {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'not_an_object' };
  const hashed = hash_canonical(raw);
  if (hashed === null) return { ok: false, reason: 'not_canonicalizable' };
  if (hashed.hash !== ch.evidence_hash.toLowerCase()) return { ok: false, reason: 'evidence_hash_mismatch' };
  const doc = raw as Partial<Evidence>;
  if (doc.chain_id !== cfg.chain_id) return { ok: false, reason: 'chain_id_mismatch' };
  if (typeof doc.manager !== 'string' || doc.manager.toLowerCase() !== cfg.manager.toLowerCase()) {
    return { ok: false, reason: 'manager_mismatch' };
  }
  if (doc.challenge_id !== ch.id) return { ok: false, reason: 'challenge_id_mismatch' };
  if (typeof doc.root !== 'string' || doc.root.toLowerCase() !== ch.root.toLowerCase()) return { ok: false, reason: 'root_mismatch' };
  return { ok: true, canonical: hashed.canonical };
}

export interface CommittedEvidence {
  canonical: string;
  evidence: Evidence;
}

/**
 * Loads the object stored under the challenge's on-chain evidence_hash and verifies it before returning.
 * Returns null when nothing is stored under that hash. Throws 500 when the stored bytes do not hash to it.
 */
export async function load_committed_evidence(r2: R2Like, chain_id: number, ch: ChallengeRow): Promise<CommittedEvidence | null> {
  const text = await get_text(r2, evidence_key(chain_id, ch.id, ch.evidence_hash));
  if (text === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ApiError(500, 'evidence_corrupt', 'stored evidence is not valid JSON');
  }
  const hashed = hash_canonical(raw);
  if (hashed === null || hashed.hash !== ch.evidence_hash.toLowerCase()) {
    throw new ApiError(500, 'evidence_hash_mismatch', 'stored evidence does not match the on-chain evidence_hash');
  }
  return { canonical: hashed.canonical, evidence: raw as Evidence };
}
