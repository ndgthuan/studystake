import { z } from 'zod';
import type { Config } from './config.ts';
import { ApiError } from './http.ts';
import { moodle_call, type MoodleOptions } from './lms/moodle.ts';
import { is_link_failure, LmsError } from './lms/types.ts';

const QUIZ_PATH = '/mod/quiz/view.php';
type QuizLookup = { cmid: number } | { instance_id: number };
const course_module_response = z.object({
  cm: z.object({ id: z.int().positive(), course: z.int().positive(), modname: z.string(), instance: z.int().positive() }),
});
const course_quizzes_response = z.object({ quizzes: z.array(z.unknown()) });
const quiz_item = z.object({
  id: z.int().positive(),
  course: z.int().positive(),
  coursemodule: z.int().positive(),
  name: z.string().trim().min(1),
  timeclose: z.int().nonnegative().optional(),
});

export function parse_quiz_url(raw: string, cfg: Pick<Config, 'moodle_sites'>): { site: string; lookup: QuizLookup } {
  const invalid_url = () => new ApiError(400, 'invalid_quiz_url', 'paste a Moodle quiz URL with one id or q parameter');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw invalid_url();
  }
  const ids = url.searchParams.getAll('id');
  const instances = url.searchParams.getAll('q');
  const [raw_id] = [...ids, ...instances];
  if (url.protocol !== 'https:' || url.username || url.password || !url.pathname.endsWith(QUIZ_PATH) ||
      ids.length + instances.length !== 1 || !raw_id || !/^[1-9]\d*$/.test(raw_id)) {
    throw invalid_url();
  }
  const id = Number(raw_id);
  if (!Number.isSafeInteger(id)) throw invalid_url();
  const site = `${url.origin}${url.pathname.slice(0, -QUIZ_PATH.length)}`;
  if (!cfg.moodle_sites.includes(site)) throw new ApiError(400, 'site_not_allowed', 'Moodle site is not on the allowlist');
  return { site, lookup: ids.length === 1 ? { cmid: id } : { instance_id: id } };
}

export async function fetch_quiz_preview(site: string, token: string, lookup: QuizLookup, opts: MoodleOptions = {}) {
  const options = { timeout_ms: 4_000, ...opts };
  try {
    const reply = 'cmid' in lookup
      ? await moodle_call(site, token, 'core_course_get_course_module', { cmid: lookup.cmid }, options)
      : await moodle_call(site, token, 'core_course_get_course_module_by_instance', { module: 'quiz', instance: lookup.instance_id }, options);
    const module = course_module_response.safeParse(reply);
    if (!module.success || ('cmid' in lookup ? module.data.cm.id !== lookup.cmid : module.data.cm.instance !== lookup.instance_id)) {
      throw new ApiError(502, 'moodle_unavailable', 'Moodle did not return the requested course module');
    }
    const { id: cmid, course, modname, instance } = module.data.cm;
    if (modname !== 'quiz') throw new ApiError(400, 'invalid_quiz_url', 'this URL does not identify a Moodle quiz');

    const list = course_quizzes_response.safeParse(await moodle_call(site, token, 'mod_quiz_get_quizzes_by_courses', {
      'courseids[0]': course,
    }, options));
    if (!list.success) throw new ApiError(502, 'moodle_unavailable', 'Moodle did not return quiz information');
    for (const item of list.data.quizzes) {
      const quiz = quiz_item.safeParse(item);
      if (quiz.success && quiz.data.id === instance && quiz.data.course === course && quiz.data.coursemodule === cmid) {
        const { name, timeclose } = quiz.data;
        return { site, course_id: course, instance_id: instance, name: name.slice(0, 200), due: timeclose || null };
      }
    }
    throw new ApiError(403, 'moodle_access_denied', 'Moodle did not return this quiz for the linked account');
  } catch (err) {
    if (!(err instanceof LmsError)) throw err;
    if (err.code === 'invalid_token') throw new ApiError(403, 'link_broken', 'Moodle rejected the linked account token');
    if (is_link_failure(err.code) || err.code === 'lms_client_error') {
      throw new ApiError(403, 'moodle_access_denied', 'Moodle did not allow this quiz lookup');
    }
    throw new ApiError(503, 'moodle_unavailable', 'Moodle could not look up this quiz');
  }
}
