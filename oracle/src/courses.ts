// Courses the linked Moodle account is enrolled in, so the web can show only challenges the student can take.
import { z } from 'zod';
import { ApiError } from './http.ts';
import { moodle_call, type MoodleOptions } from './lms/moodle.ts';
import { is_link_failure, LmsError } from './lms/types.ts';

const enrolled_courses = z.array(z.object({ id: z.int().positive() }).loose());

/** Course ids from core_enrol_get_users_courses. Only ids leave the oracle, never names or grades. */
export async function fetch_enrolled_course_ids(site: string, token: string, userid: number, opts: MoodleOptions = {}): Promise<number[]> {
  try {
    const reply = enrolled_courses.safeParse(
      await moodle_call(site, token, 'core_enrol_get_users_courses', { userid }, { timeout_ms: 6_000, ...opts }),
    );
    if (!reply.success) throw new ApiError(502, 'moodle_unavailable', 'Moodle did not return the course list');
    return [...new Set(reply.data.map((c) => c.id))].sort((a, b) => a - b);
  } catch (err) {
    if (!(err instanceof LmsError)) throw err;
    if (err.code === 'invalid_token') throw new ApiError(403, 'link_broken', 'Moodle rejected the linked account token');
    if (is_link_failure(err.code) || err.code === 'lms_client_error') {
      throw new ApiError(403, 'moodle_access_denied', 'Moodle did not allow reading the course list');
    }
    throw new ApiError(503, 'moodle_unavailable', 'Moodle could not return the course list');
  }
}
