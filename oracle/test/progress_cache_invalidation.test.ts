import { describe, expect, it } from 'vitest';
import { progress_cache_key, PROGRESS_CACHE_TTL_SECONDS } from '../src/progress.ts';
import { make_memory_kv } from './support/kv.ts';

const WALLET = '0x' + 'cd'.repeat(20);

describe('progress cache invalidation after a demo submit', () => {
  it('the key is per (challenge, wallet) and lowercases the wallet', () => {
    expect(progress_cache_key(3, WALLET.toUpperCase().replace('0X', '0x'))).toBe(`progress:v2:3:${WALLET}`);
  });

  it('deleting the key for one challenge leaves another challenge cached', async () => {
    const kv = make_memory_kv();
    await kv.put(progress_cache_key(1, WALLET), '{"stale":true}', { expirationTtl: PROGRESS_CACHE_TTL_SECONDS });
    await kv.put(progress_cache_key(2, WALLET), '{"other":true}', { expirationTtl: PROGRESS_CACHE_TTL_SECONDS });

    // Mirrors the delete performed by POST /demo/submit after a successful record.
    await kv.delete(progress_cache_key(1, WALLET));

    expect(await kv.get(progress_cache_key(1, WALLET))).toBeNull();
    expect(await kv.get(progress_cache_key(2, WALLET))).toBe('{"other":true}');
  });
});
