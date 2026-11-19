// KV and R2 helpers. Every module talks to storage through these, so tests and E2E can use the in-memory shim in test/support.
import type { KvLike } from './lms/demo.ts';

export interface R2Like {
  put(key: string, value: string, opts?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ text(): Promise<string> } | null>;
}

export interface Store {
  kv: KvLike;
  r2: R2Like;
}

export interface LinkRecord {
  wallet: string;
  lms: 'moodle' | 'demo';
  site: string;
  userid: number | null;
  subject_hash: string;
  token_enc: string | null;
  linked_at?: number;
  revoked?: true;
}

export const LOCK_TTL_SECONDS = 240;

export function link_key(wallet: string): string {
  return `link:${wallet.toLowerCase()}`;
}

export function subject_key(subject_hash: string): string {
  return `subject:${subject_hash}`;
}

export async function get_json<T>(kv: KvLike, key: string): Promise<T | null> {
  const raw = await kv.get(key);
  return raw === null ? null : (JSON.parse(raw) as T);
}

export async function put_json(kv: KvLike, key: string, value: unknown, ttl?: number): Promise<void> {
  await kv.put(key, JSON.stringify(value), ttl ? { expirationTtl: ttl } : undefined);
}

export async function get_link(kv: KvLike, wallet: string): Promise<LinkRecord | null> {
  return get_json<LinkRecord>(kv, link_key(wallet));
}

export function link_is_active(link: LinkRecord | null): link is LinkRecord {
  return link !== null && !link.revoked && (link.lms === 'demo' || link.token_enc !== null);
}

/**
 * Tries to take a KV lock. KV is not atomic, so this is best effort: two overlapping runs could both acquire it.
 * Settlement stays safe anyway because the contract accepts only one settle per challenge.
 */
export async function try_lock(kv: KvLike, name: string): Promise<boolean> {
  const key = `lock:${name}`;
  if ((await kv.get(key)) !== null) return false;
  await kv.put(key, '1', { expirationTtl: LOCK_TTL_SECONDS });
  return true;
}

export async function unlock(kv: KvLike, name: string): Promise<void> {
  await kv.delete(`lock:${name}`);
}

export async function put_evidence(r2: R2Like, key: string, canonical: string): Promise<void> {
  await r2.put(key, canonical, { httpMetadata: { contentType: 'application/json' } });
}

export async function get_text(r2: R2Like, key: string): Promise<string | null> {
  const obj = await r2.get(key);
  return obj === null ? null : obj.text();
}
