// Moodle REST adapter. I/O lives here, parsing is in moodle_parse.ts.
import { assert_not_exception, parse_assign_status, parse_quiz_attempts, parse_site_info_userid } from './moodle_parse.ts';
import { LmsError, type ActivityRef, type ActivityStatus, type LinkInfo, type LmsAdapter } from './types.ts';

export const MOODLE_TIMEOUT_MS = 10_000;
export const MOODLE_RETRIES = 2;

export interface MoodleOptions {
  fetch_impl?: typeof fetch;
  timeout_ms?: number;
  retry_delay_ms?: number;
  /** Whether grades are requested (min_grade != null on the challenge). */
  want_grade?: boolean;
}

/** Raw HTTP call with timeout, then a retry for network and 5xx errors only. 4xx and exceptions are not retried. */
export async function moodle_call(
  site: string,
  token: string,
  wsfunction: string,
  params: Record<string, string | number>,
  opts: MoodleOptions = {},
): Promise<unknown> {
  const fetch_impl = opts.fetch_impl ?? fetch;
  const timeout_ms = opts.timeout_ms ?? MOODLE_TIMEOUT_MS;
  const retry_delay_ms = opts.retry_delay_ms ?? 500;
  const url = `${site.replace(/\/+$/, '')}/webservice/rest/server.php`;

  const body = new URLSearchParams({
    wstoken: token,
    moodlewsrestformat: 'json',
    wsfunction,
  });
  for (const [k, v] of Object.entries(params)) body.set(k, String(v));

  let last_error: LmsError | null = null;
  for (let attempt = 0; attempt <= MOODLE_RETRIES; attempt++) {
    if (attempt > 0) await sleep(retry_delay_ms * attempt);
    try {
      const res = await fetch_impl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(timeout_ms),
      });
      if (res.status >= 500) {
        last_error = new LmsError(`Moodle HTTP ${res.status}`, 'lms_error');
        continue;
      }
      if (res.status >= 400) {
        throw new LmsError(`Moodle HTTP ${res.status}`, 'lms_client_error');
      }
      const json = (await res.json()) as unknown;
      assert_not_exception(json);
      return json;
    } catch (err) {
      if (err instanceof LmsError) {
        if (err.code === 'lms_error') {
          last_error = err;
          continue;
        }
        throw err;
      }
      const is_timeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      last_error = new LmsError(is_timeout ? 'Moodle request timed out' : 'Moodle network error', is_timeout ? 'timeout' : 'lms_error');
    }
  }
  throw last_error ?? new LmsError('Moodle unknown error', 'lms_error');
}

export function create_moodle_adapter(opts: MoodleOptions = {}): LmsAdapter {
  return {
    async get_activity_status(link: LinkInfo, activity: ActivityRef): Promise<ActivityStatus> {
      if (link.token === null || link.userid === null) {
        throw new LmsError('link has no moodle token', 'not_linked');
      }
      const common = { userid: link.userid };
      if (activity.kind === 'quiz') {
        const body = await moodle_call(
          link.site,
          link.token,
          'mod_quiz_get_user_attempts',
          { quizid: activity.instance_id, ...common, status: 'finished', includepreviews: 0 },
          opts,
        );
        return parse_quiz_attempts(body, opts.want_grade === true);
      }
      const body = await moodle_call(
        link.site,
        link.token,
        'mod_assign_get_submission_status',
        { assignid: activity.instance_id, ...common },
        opts,
      );
      return parse_assign_status(body);
    },
  };
}

/** Calls core_webservice_get_site_info and returns the userid. Used when linking. */
export async function fetch_userid(site: string, token: string, opts: MoodleOptions = {}): Promise<number> {
  const body = await moodle_call(site, token, 'core_webservice_get_site_info', {}, opts);
  return parse_site_info_userid(body);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
