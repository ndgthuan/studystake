// Fixed-window rate limit on KV, keyed by route and client IP.
import type { KvLike } from './lms/demo.ts';

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
}

/** Pure window math. window_start is floor(now / window_seconds) * window_seconds. */
export function window_key(route: string, ip: string, now_seconds: number, window_seconds: number): string {
  const window_start = Math.floor(now_seconds / window_seconds) * window_seconds;
  return `rl:${route}:${ip}:${window_start}`;
}

/** Increments the counter for the current window and reports whether the request is allowed. */
export async function check_rate_limit(
  kv: KvLike,
  route: string,
  ip: string,
  limit: number,
  window_seconds: number,
  now_seconds: number,
): Promise<RateLimitResult> {
  const key = window_key(route, ip, now_seconds, window_seconds);
  const current = Number((await kv.get(key)) ?? '0');
  const next = current + 1;
  if (next > limit) return { allowed: false, count: current, limit };
  await kv.put(key, String(next), { expirationTtl: window_seconds * 2 });
  return { allowed: true, count: next, limit };
}
