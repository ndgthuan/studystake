// Progress endpoint helpers: cache key, rate limit and the LMS error mapping. Pure, no I/O.
import { is_link_failure, type LmsErrorCode } from './lms/types.ts';

/** Per-IP limit for GET /progress. Each request can call the school Moodle, so this bounds that traffic. */
export const PROGRESS_RATE_LIMIT = 20;
export const PROGRESS_RATE_WINDOW_SECONDS = 60;
/** Computed progress is cached per (challenge, wallet) for this long. */
export const PROGRESS_CACHE_TTL_SECONDS = 60;

export function progress_cache_key(challenge_id: number, wallet: string, scope = ''): string {
  const key = `progress:v2:${challenge_id}:${wallet.toLowerCase()}`;
  return scope ? `${key}:${scope}` : key;
}

/**
 * Maps an adapter failure to the state shown in progress. Never includes token material or raw LMS text.
 * Invalid tokens and LMS outages are reported as unknown so the UI does not claim the student failed.
 */
export function progress_user_error(code: LmsErrorCode | 'other'): 'link_broken' | 'lms_unavailable' | 'unknown' {
  if (code !== 'other' && is_link_failure(code)) return 'link_broken';
  if (code === 'timeout' || code === 'lms_error' || code === 'lms_client_error') return 'lms_unavailable';
  return 'unknown';
}
