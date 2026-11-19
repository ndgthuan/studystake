// Study Credential: the EIP-712 statement the oracle signs and sells over x402, and the student's consent to sell it.
// Spec: docs/X402.md. Nothing here is reachable for free: the paid route must check payment before issuing.
import { getAddress, keccak256, toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { BadgeStats } from './chain.ts';
import type { KvLike } from './lms/demo.ts';
import { get_json, get_link, put_json, type LinkRecord } from './store.ts';

/** Long enough to be useful, short enough that stats and revoked consent cannot stay valid forever. */
export const CREDENTIAL_TTL_SECONDS = 604_800;

export const CREDENTIAL_TYPES = {
  Credential: [
    { name: 'wallet', type: 'address' },
    { name: 'lms', type: 'string' },
    { name: 'subject_hash', type: 'bytes32' },
    { name: 'site_hash', type: 'bytes32' },
    { name: 'streak', type: 'uint32' },
    { name: 'best_streak', type: 'uint32' },
    { name: 'total_completed', type: 'uint32' },
    { name: 'total_failed', type: 'uint32' },
    { name: 'issued_at', type: 'uint64' },
    { name: 'expires_at', type: 'uint64' },
  ],
} as const;

export interface Credential extends BadgeStats {
  wallet: `0x${string}`;
  lms: LinkRecord['lms'];
  subject_hash: `0x${string}`;
  site_hash: `0x${string}`;
  issued_at: number;
  expires_at: number;
}

export interface SignedCredential {
  credential: Credential;
  signature: `0x${string}`;
  signer: `0x${string}`;
  domain: { name: string; version: string; chain_id: number; verifying_contract: `0x${string}` };
}

export interface ConsentRecord {
  share: boolean;
  subject_hash: string;
  updated_at: number;
}

export function credential_domain(chain_id: number, manager: `0x${string}`) {
  return { name: 'StudyStake Credential', version: '1', chainId: chain_id, verifyingContract: getAddress(manager) };
}

/** Builds the statement from a link and on-chain stats. Pure, takes `now` as input. */
export function build_credential(link: LinkRecord, stats: BadgeStats, now_seconds: number): Credential {
  return {
    wallet: getAddress(link.wallet),
    lms: link.lms,
    subject_hash: link.subject_hash as `0x${string}`,
    site_hash: keccak256(toBytes(link.site)),
    streak: stats.streak,
    best_streak: stats.best_streak,
    total_completed: stats.total_completed,
    total_failed: stats.total_failed,
    issued_at: now_seconds,
    expires_at: now_seconds + CREDENTIAL_TTL_SECONDS,
  };
}

/** Typed data for signing and verifying. JSON carries uint64 as numbers, EIP-712 encoding takes them as bigint. */
export function credential_typed_data(credential: Credential, chain_id: number, manager: `0x${string}`) {
  return {
    domain: credential_domain(chain_id, manager),
    types: CREDENTIAL_TYPES,
    primaryType: 'Credential' as const,
    message: { ...credential, issued_at: BigInt(credential.issued_at), expires_at: BigInt(credential.expires_at) },
  };
}

/** Signs a credential with the oracle key. A verifier checks that the signer holds ORACLE_ROLE on the manager. */
export async function issue_credential(params: {
  link: LinkRecord;
  stats: BadgeStats;
  now_seconds: number;
  chain_id: number;
  manager: `0x${string}`;
  oracle_private_key: `0x${string}`;
}): Promise<SignedCredential> {
  const account = privateKeyToAccount(params.oracle_private_key);
  const credential = build_credential(params.link, params.stats, params.now_seconds);
  const signature = await account.signTypedData(credential_typed_data(credential, params.chain_id, params.manager));
  return {
    credential,
    signature,
    signer: account.address,
    domain: { name: 'StudyStake Credential', version: '1', chain_id: params.chain_id, verifying_contract: getAddress(params.manager) },
  };
}

export function consent_key(wallet: string): string {
  return `consent:${wallet.toLowerCase()}`;
}

/** Off by default. Consent covers one LMS account, so linking the wallet to another account voids it. */
export function is_shared(consent: ConsentRecord | null, link: LinkRecord | null): boolean {
  return consent !== null && link !== null && !link.revoked && consent.share && consent.subject_hash === link.subject_hash;
}

/** Whether a credential may be sold for this wallet right now. */
export async function read_share_state(kv: KvLike, wallet: string): Promise<{ link: LinkRecord | null; share: boolean }> {
  const link = await get_link(kv, wallet);
  const consent = await get_json<ConsentRecord>(kv, consent_key(wallet));
  return { link, share: is_shared(consent, link) };
}

export async function write_consent(kv: KvLike, link: LinkRecord, share: boolean, now_seconds: number): Promise<void> {
  const record: ConsentRecord = { share, subject_hash: link.subject_hash, updated_at: now_seconds };
  await put_json(kv, consent_key(link.wallet), record);
}
