// Faucet logic. Pure eligibility checks plus the send helper. One grant per Privy user and per wallet, daily cap across all.
import { ApiError } from './http.ts';
import type { KvLike } from './lms/demo.ts';

export const FAUCET_MIN_BALANCE_WEI = 20_000_000_000_000_000n; // 0.02 AVAX

export function utc_day(now_seconds: number): string {
  return new Date(now_seconds * 1000).toISOString().slice(0, 10);
}

export function faucet_user_key(privy_sub: string): string {
  return `faucet:user:${privy_sub}`;
}

export function faucet_wallet_key(wallet: string): string {
  return `faucet:wallet:${wallet.toLowerCase()}`;
}

export function faucet_daily_key(now_seconds: number): string {
  return `faucet:daily:${utc_day(now_seconds)}`;
}

/** Throws ApiError when the wallet is ineligible. Pure given the current balance and KV state. */
export async function assert_faucet_eligible(params: {
  kv: KvLike;
  privy_sub: string;
  wallet: string;
  balance_wei: bigint;
  daily_cap: number;
  now_seconds: number;
}): Promise<void> {
  const { kv, privy_sub, wallet, balance_wei, daily_cap, now_seconds } = params;
  if (balance_wei >= FAUCET_MIN_BALANCE_WEI) throw new ApiError(409, 'already_funded', 'wallet already holds enough AVAX');
  if ((await kv.get(faucet_user_key(privy_sub))) !== null) throw new ApiError(409, 'user_already_claimed', 'this account already claimed');
  if ((await kv.get(faucet_wallet_key(wallet))) !== null) throw new ApiError(409, 'wallet_already_claimed', 'this wallet already claimed');
  const used = Number((await kv.get(faucet_daily_key(now_seconds))) ?? '0');
  if (used >= daily_cap) throw new ApiError(429, 'daily_cap', 'daily faucet cap reached');
}

/** Value written while a send is in flight. A pending reservation blocks a second grant like a finished one does. */
export const FAUCET_PENDING = 'pending';
/** Pending reservations expire on their own so a crashed send cannot lock a user out forever. */
export const FAUCET_PENDING_TTL_SECONDS = 300;

/**
 * Reserves the per-user and per-wallet keys with the 'pending' value and bumps the daily counter, before any send.
 * Throws 409 when either key already exists. KV is not atomic, so the check and write are best effort.
 */
export async function reserve_faucet_grant(params: {
  kv: KvLike;
  privy_sub: string;
  wallet: string;
  now_seconds: number;
}): Promise<void> {
  const { kv, privy_sub, wallet, now_seconds } = params;
  if ((await kv.get(faucet_user_key(privy_sub))) !== null) throw new ApiError(409, 'user_already_claimed', 'this account already claimed');
  if ((await kv.get(faucet_wallet_key(wallet))) !== null) throw new ApiError(409, 'wallet_already_claimed', 'this wallet already claimed');
  await kv.put(faucet_user_key(privy_sub), FAUCET_PENDING, { expirationTtl: FAUCET_PENDING_TTL_SECONDS });
  await kv.put(faucet_wallet_key(wallet), FAUCET_PENDING, { expirationTtl: FAUCET_PENDING_TTL_SECONDS });
  const day_key = faucet_daily_key(now_seconds);
  const used = Number((await kv.get(day_key)) ?? '0');
  await kv.put(day_key, String(used + 1), { expirationTtl: 2 * 24 * 3600 });
}

/** Send failed: remove the pending keys and give the daily slot back. */
export async function release_faucet_reservation(params: {
  kv: KvLike;
  privy_sub: string;
  wallet: string;
  now_seconds: number;
}): Promise<void> {
  const { kv, privy_sub, wallet, now_seconds } = params;
  await kv.delete(faucet_user_key(privy_sub));
  await kv.delete(faucet_wallet_key(wallet));
  const day_key = faucet_daily_key(now_seconds);
  const used = Number((await kv.get(day_key)) ?? '0');
  if (used > 0) await kv.put(day_key, String(used - 1), { expirationTtl: 2 * 24 * 3600 });
}

/** Send succeeded: overwrite the pending values with the tx hash. */
export async function finalize_faucet_grant(params: {
  kv: KvLike;
  privy_sub: string;
  wallet: string;
  now_seconds: number;
  tx_hash: string;
}): Promise<void> {
  const { kv, privy_sub, wallet, now_seconds, tx_hash } = params;
  await kv.put(faucet_user_key(privy_sub), JSON.stringify({ wallet, tx_hash, at: now_seconds }));
  await kv.put(faucet_wallet_key(wallet), JSON.stringify({ tx_hash, at: now_seconds }));
}

/**
 * Full grant: eligibility, reserve (pending keys written before any send), send, then overwrite with the tx hash.
 * On send failure the reservation is released so the user can retry.
 */
export async function run_faucet_grant(params: {
  kv: KvLike;
  privy_sub: string;
  wallet: string;
  balance_wei: bigint;
  daily_cap: number;
  now_seconds: number;
  send: (wallet: string) => Promise<string>;
}): Promise<string> {
  const { kv, privy_sub, wallet, balance_wei, daily_cap, now_seconds, send } = params;
  await assert_faucet_eligible({ kv, privy_sub, wallet, balance_wei, daily_cap, now_seconds });
  await reserve_faucet_grant({ kv, privy_sub, wallet, now_seconds });
  let tx_hash: string;
  try {
    tx_hash = await send(wallet);
  } catch (err) {
    await release_faucet_reservation({ kv, privy_sub, wallet, now_seconds });
    throw err;
  }
  await finalize_faucet_grant({ kv, privy_sub, wallet, now_seconds, tx_hash });
  return tx_hash;
}

/** Cloudflare Turnstile server-side check. Skipped (returns true) when no secret is configured. */
export async function verify_turnstile(secret: string | null, token: string | undefined, ip: string, fetch_impl: typeof fetch = fetch): Promise<boolean> {
  if (secret === null) return true;
  if (!token) return false;
  const body = new URLSearchParams({ secret, response: token, remoteip: ip });
  const res = await fetch_impl('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
  if (!res.ok) return false;
  const json = (await res.json()) as { success?: boolean };
  return json.success === true;
}
