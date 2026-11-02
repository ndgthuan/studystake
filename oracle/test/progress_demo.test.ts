import { describe, expect, it } from 'vitest';
import { create_demo_adapter, demo_submission_key, has_demo_activity, record_demo_submission } from '../src/lms/demo.ts';
import { PROGRESS_CACHE_TTL_SECONDS, PROGRESS_RATE_LIMIT, progress_cache_key, progress_user_error } from '../src/progress.ts';
import { check_rate_limit } from '../src/ratelimit.ts';
import { LmsError, type LinkInfo } from '../src/lms/types.ts';
import { make_memory_kv } from './support/kv.ts';

const WALLET = '0x' + 'ab'.repeat(20);
const quiz = { kind: 'quiz' as const, instance_id: 5, name: 'Quiz', due: 9_999_999_999 };

function demo_link(challenge_id: number): LinkInfo {
  return { lms: 'demo', site: 'demo', userid: null, wallet: WALLET, token: null, challenge_id };
}

describe('F4 demo submissions are scoped by challenge', () => {
  it('the storage key includes the challenge id and lowercases the wallet', () => {
    expect(demo_submission_key(WALLET.toUpperCase().replace('0X', '0x'), 7, 5)).toBe(`demo:${WALLET}:7:5`);
  });

  it('a submission for challenge 1 does not satisfy challenge 2 with the same instance_id', async () => {
    const kv = make_memory_kv();
    await record_demo_submission(kv, WALLET, 1, 5, 1000);
    const adapter = create_demo_adapter(kv);
    expect((await adapter.get_activity_status(demo_link(1), quiz)).submitted).toBe(true);
    expect((await adapter.get_activity_status(demo_link(2), quiz)).submitted).toBe(false);
  });

  it('demo adapter returns the submission as a one-element finished_times list', async () => {
    const kv = make_memory_kv();
    await record_demo_submission(kv, WALLET, 3, 5, 1234);
    const s = await create_demo_adapter(kv).get_activity_status(demo_link(3), quiz);
    expect(s).toEqual({ submitted: true, finished_times: [1234], finished_grades: [null], raw_status: 'demo_submitted' });
  });
});

describe('F4 demo submit validation', () => {
  const activities = [
    { kind: 'quiz', instance_id: 1, name: 'Q', due: 1 },
    { kind: 'assign', instance_id: 2, name: 'A', due: 1 },
  ];

  it('accepts an instance_id that belongs to the challenge', () => {
    expect(has_demo_activity(activities, 2)).toBe(true);
  });

  it('rejects an instance_id that is not one of the challenge activities', () => {
    expect(has_demo_activity(activities, 99)).toBe(false);
  });
});

describe('F4 progress cache and rate limit', () => {
  it('cache key is per (challenge, lowercased wallet)', () => {
    expect(progress_cache_key(4, WALLET.toUpperCase().replace('0X', '0x'))).toBe(`progress:4:${WALLET}`);
    expect(progress_cache_key(4, WALLET)).not.toBe(progress_cache_key(5, WALLET));
  });

  it('cache TTL is 60 seconds', () => {
    expect(PROGRESS_CACHE_TTL_SECONDS).toBe(60);
  });

  it('rate limit allows 20 per minute per IP and then blocks', async () => {
    const kv = make_memory_kv();
    let allowed = 0;
    for (let i = 0; i < PROGRESS_RATE_LIMIT + 5; i++) {
      if ((await check_rate_limit(kv, 'progress', '1.2.3.4', PROGRESS_RATE_LIMIT, 60, 1000)).allowed) allowed++;
    }
    expect(PROGRESS_RATE_LIMIT).toBe(20);
    expect(allowed).toBe(20);
  });
});

describe('F4 progress error mapping', () => {
  it('maps invalid tokens and unlinked accounts to link_broken without any token text', () => {
    expect(progress_user_error('invalid_token')).toBe('link_broken');
    expect(progress_user_error('not_linked')).toBe('link_broken');
  });

  it('maps timeouts and LMS failures to lms_unavailable', () => {
    expect(progress_user_error('timeout')).toBe('lms_unavailable');
    expect(progress_user_error('lms_error')).toBe('lms_unavailable');
    expect(progress_user_error('lms_client_error')).toBe('lms_unavailable');
  });

  it('unknown errors map to unknown', () => {
    expect(progress_user_error('other')).toBe('unknown');
  });

  it('LmsError carries its code for the mapping', () => {
    const err = new LmsError('Moodle token is invalid or revoked', 'invalid_token');
    expect(progress_user_error(err.code)).toBe('link_broken');
    expect(err.message).not.toMatch(/SECRET/);
  });
});
