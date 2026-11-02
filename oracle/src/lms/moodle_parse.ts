// Pure parsing of Moodle REST responses. No I/O.
import { LmsError, type ActivityStatus } from './types.ts';

export interface MoodleException {
  exception: string;
  errorcode: string;
  message?: string;
}

/** Moodle returns errors as {exception, errorcode} even with HTTP 200. Throws the mapped error. */
export function assert_not_exception(body: unknown): void {
  if (body === null || typeof body !== 'object') return;
  const obj = body as Partial<MoodleException>;
  if (typeof obj.exception === 'string') {
    if (obj.errorcode === 'invalidtoken') {
      throw new LmsError('Moodle token is invalid or revoked', 'invalid_token');
    }
    throw new LmsError(`Moodle exception: ${obj.errorcode ?? obj.exception}`, 'lms_client_error');
  }
}

interface QuizAttemptRaw {
  state?: unknown;
  timefinish?: unknown;
  sumgrades?: unknown;
}

function not_submitted(raw_status: string): ActivityStatus {
  return { submitted: false, finished_times: [], finished_grades: [], raw_status };
}

/**
 * Parses mod_quiz_get_user_attempts. Returns every finished attempt (timefinish, sorted ascending),
 * so the evaluator can pick the earliest one inside the valid window. Grades (sumgrades) are
 * returned only when want_grade is true; otherwise each grade is null.
 */
export function parse_quiz_attempts(body: unknown, want_grade: boolean): ActivityStatus {
  assert_not_exception(body);
  const attempts = (body as { attempts?: unknown } | null)?.attempts;
  if (!Array.isArray(attempts)) {
    throw new LmsError('quiz response missing attempts array', 'lms_error');
  }
  const finished: { time: number; grade: number | null }[] = [];
  let in_progress = false;
  for (const raw of attempts as QuizAttemptRaw[]) {
    if (raw.state === 'inprogress') in_progress = true;
    if (raw.state !== 'finished') continue;
    const time = Number(raw.timefinish);
    if (!Number.isFinite(time) || time <= 0) continue;
    const grade = want_grade && raw.sumgrades !== undefined && raw.sumgrades !== null ? Number(raw.sumgrades) : null;
    finished.push({ time, grade: grade !== null && Number.isFinite(grade) ? grade : null });
  }
  if (finished.length === 0) return not_submitted(in_progress ? 'inprogress' : 'none');
  finished.sort((a, b) => a.time - b.time);
  return {
    submitted: true,
    finished_times: finished.map((f) => f.time),
    finished_grades: finished.map((f) => f.grade),
    raw_status: 'finished',
  };
}

interface AssignSubmissionRaw {
  status?: unknown;
  timemodified?: unknown;
}

/**
 * Parses mod_assign_get_submission_status. Valid when lastattempt.submission.status == 'submitted',
 * time is submission.timemodified. Grade is not fetched here (grade stays null).
 */
export function parse_assign_status(body: unknown): ActivityStatus {
  assert_not_exception(body);
  const last = (body as { lastattempt?: { submission?: AssignSubmissionRaw } } | null)?.lastattempt;
  const submission = last?.submission;
  const status = typeof submission?.status === 'string' ? submission.status : 'new';
  if (status !== 'submitted') return not_submitted(status);
  const time = Number(submission?.timemodified);
  if (!Number.isFinite(time) || time <= 0) return not_submitted('submitted_no_time');
  return { submitted: true, finished_times: [time], finished_grades: [null], raw_status: 'submitted' };
}

/** Parses core_webservice_get_site_info and returns the numeric userid. */
export function parse_site_info_userid(body: unknown): number {
  assert_not_exception(body);
  const userid = (body as { userid?: unknown } | null)?.userid;
  if (typeof userid !== 'number' || !Number.isInteger(userid) || userid <= 0) {
    throw new LmsError('site info missing userid', 'lms_error');
  }
  return userid;
}
