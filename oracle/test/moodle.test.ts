import { describe, expect, it } from 'vitest';
import { create_moodle_adapter, moodle_call, MOODLE_RETRIES } from '../src/lms/moodle.ts';
import { parse_assign_status, parse_quiz_attempts } from '../src/lms/moodle_parse.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LmsError, type ActivityRef, type LinkInfo } from '../src/lms/types.ts';
const load_fixture = (name: string) => JSON.parse(readFileSync(join(process.cwd(), 'test/fixtures', name), 'utf8'));
const quiz_fixture = load_fixture('quiz_attempts.json');
const assign_fixture = load_fixture('assign_status.json');

const SITE = 'https://courses.ctda.hcmus.edu.vn';
const link: LinkInfo = { lms: 'moodle', site: SITE, userid: 42, wallet: '0x' + '1'.repeat(40), token: 'SECRET_TOKEN_VALUE', challenge_id: 1 };
const quiz: ActivityRef = { kind: 'quiz', instance_id: 567, name: 'Quiz 10', due: 1763650800 };
const assign: ActivityRef = { kind: 'assign', instance_id: 890, name: 'Essay', due: 1763650800 };

function json_fetch(bodies: { status?: number; json?: unknown; throw?: Error }[]) {
  const calls: { url: string; body: string }[] = [];
  let i = 0;
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: String(init.body) });
    const step = bodies[Math.min(i++, bodies.length - 1)]!;
    if (step.throw) throw step.throw;
    return new Response(JSON.stringify(step.json ?? {}), { status: step.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('parse_quiz_attempts', () => {
  it('returns every finished attempt time sorted ascending and ignores inprogress', () => {
    const r = parse_quiz_attempts(quiz_fixture.finished_and_inprogress, false);
    expect(r).toEqual({
      submitted: true,
      finished_times: [1763450000, 1763600000],
      finished_grades: [null, null],
      raw_status: 'finished',
    });
  });

  it('reports inprogress only as not submitted', () => {
    const r = parse_quiz_attempts(quiz_fixture.only_inprogress, false);
    expect(r).toMatchObject({ submitted: false, finished_times: [], raw_status: 'inprogress' });
  });

  it('returns grades per attempt only when requested', () => {
    expect(parse_quiz_attempts(quiz_fixture.finished_and_inprogress, true).finished_grades).toEqual([3, 8.5]);
  });

  it('empty attempts array means not submitted', () => {
    expect(parse_quiz_attempts(quiz_fixture.empty, false)).toMatchObject({ submitted: false, finished_times: [], raw_status: 'none' });
  });

  it('throws on Moodle exception body even with 200', () => {
    expect(() => parse_quiz_attempts(quiz_fixture.exception, false)).toThrow(LmsError);
  });
});

describe('parse_assign_status', () => {
  it('submitted assign uses timemodified', () => {
    expect(parse_assign_status(assign_fixture.submitted)).toEqual({
      submitted: true,
      finished_times: [1763500000],
      finished_grades: [null],
      raw_status: 'submitted',
    });
  });

  it('new assign is not submitted', () => {
    expect(parse_assign_status(assign_fixture.new)).toMatchObject({ submitted: false, finished_times: [], raw_status: 'new' });
  });

  it('draft is not submitted', () => {
    expect(parse_assign_status(assign_fixture.draft)).toMatchObject({ submitted: false, finished_times: [], raw_status: 'draft' });
  });
});

describe('moodle adapter', () => {
  it('sends the quiz call with the expected parameters and returns parsed status', async () => {
    const { impl, calls } = json_fetch([{ json: quiz_fixture.finished_and_inprogress }]);
    const adapter = create_moodle_adapter({ fetch_impl: impl, retry_delay_ms: 0 });
    const s = await adapter.get_activity_status(link, quiz);
    expect(s.submitted).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${SITE}/webservice/rest/server.php`);
    const sent = new URLSearchParams(calls[0]!.body);
    expect(sent.get('wsfunction')).toBe('mod_quiz_get_user_attempts');
    expect(sent.get('quizid')).toBe('567');
    expect(sent.get('userid')).toBe('42');
    expect(sent.get('status')).toBe('finished');
    expect(sent.get('includepreviews')).toBe('0');
    expect(sent.get('moodlewsrestformat')).toBe('json');
  });

  it('calls mod_assign_get_submission_status for assign', async () => {
    const { impl, calls } = json_fetch([{ json: assign_fixture.submitted }]);
    const s = await create_moodle_adapter({ fetch_impl: impl }).get_activity_status(link, assign);
    expect(s.submitted).toBe(true);
    expect(new URLSearchParams(calls[0]!.body).get('wsfunction')).toBe('mod_assign_get_submission_status');
    expect(new URLSearchParams(calls[0]!.body).get('assignid')).toBe('890');
  });

  it('invalidtoken maps to LmsError invalid_token and never leaks the token in the message', async () => {
    const { impl } = json_fetch([{ json: quiz_fixture.invalidtoken }]);
    const err = await create_moodle_adapter({ fetch_impl: impl })
      .get_activity_status(link, quiz)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LmsError);
    expect((err as LmsError).code).toBe('invalid_token');
    expect(String((err as Error).message)).not.toContain('SECRET_TOKEN_VALUE');
  });

  it('exception with HTTP 200 is not retried', async () => {
    const { impl, calls } = json_fetch([{ json: quiz_fixture.exception }]);
    await expect(create_moodle_adapter({ fetch_impl: impl }).get_activity_status(link, quiz)).rejects.toMatchObject({ code: 'lms_client_error' });
    expect(calls).toHaveLength(1);
  });

  it('retries 5xx then succeeds', async () => {
    const { impl, calls } = json_fetch([{ status: 503, json: {} }, { status: 500, json: {} }, { json: quiz_fixture.finished_and_inprogress }]);
    const s = await create_moodle_adapter({ fetch_impl: impl, retry_delay_ms: 0 }).get_activity_status(link, quiz);
    expect(s.submitted).toBe(true);
    expect(calls).toHaveLength(3);
  });

  it('gives up after MOODLE_RETRIES retries on persistent 5xx with lms_error', async () => {
    const { impl, calls } = json_fetch([{ status: 502, json: {} }]);
    await expect(create_moodle_adapter({ fetch_impl: impl, retry_delay_ms: 0 }).get_activity_status(link, quiz)).rejects.toMatchObject({
      code: 'lms_error',
    });
    expect(calls).toHaveLength(MOODLE_RETRIES + 1);
  });

  it('does not retry 4xx', async () => {
    const { impl, calls } = json_fetch([{ status: 404, json: {} }]);
    await expect(create_moodle_adapter({ fetch_impl: impl, retry_delay_ms: 0 }).get_activity_status(link, quiz)).rejects.toMatchObject({
      code: 'lms_client_error',
    });
    expect(calls).toHaveLength(1);
  });

  it('timeout is reported as timeout after retries', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const { impl, calls } = json_fetch([{ throw: timeout }]);
    await expect(create_moodle_adapter({ fetch_impl: impl, retry_delay_ms: 0 }).get_activity_status(link, quiz)).rejects.toMatchObject({
      code: 'timeout',
    });
    expect(calls).toHaveLength(MOODLE_RETRIES + 1);
  });

  it('a real timeout via AbortSignal is caught as timeout', async () => {
    const impl = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' })));
      })) as unknown as typeof fetch;
    await expect(
      moodle_call(SITE, 'tok', 'core_webservice_get_site_info', {}, { fetch_impl: impl, timeout_ms: 20, retry_delay_ms: 0 }),
    ).rejects.toMatchObject({ code: 'timeout' });
  });

  it('network error is retried and mapped to lms_error', async () => {
    const { impl, calls } = json_fetch([{ throw: new TypeError('fetch failed') }]);
    await expect(create_moodle_adapter({ fetch_impl: impl, retry_delay_ms: 0 }).get_activity_status(link, quiz)).rejects.toMatchObject({
      code: 'lms_error',
    });
    expect(calls).toHaveLength(MOODLE_RETRIES + 1);
  });

  it('refuses to call Moodle without a token', async () => {
    const { impl, calls } = json_fetch([{ json: {} }]);
    await expect(
      create_moodle_adapter({ fetch_impl: impl }).get_activity_status({ ...link, token: null }, quiz),
    ).rejects.toMatchObject({ code: 'not_linked' });
    expect(calls).toHaveLength(0);
  });
});
