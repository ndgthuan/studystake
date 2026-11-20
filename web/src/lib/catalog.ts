// Which challenges a list shows. Pure helpers so they can be unit tested.
import { HIDDEN_CHALLENGES } from './config';
import { same_site } from './moodle';
import type { LinkState, MoodleCourses } from './oracle';

export interface CatalogRowKey {
  id: number;
  lms_kind?: 'moodle' | 'demo';
  site?: string;
  course_id?: number;
}

/** Rows the public catalog may show: everything except the pilot and test rounds. */
export function public_rows<T extends { id: number }>(rows: T[] | undefined, hidden: ReadonlySet<number> = HIDDEN_CHALLENGES): T[] {
  return (rows ?? []).filter((r) => !hidden.has(r.id));
}

/** Challenges the linked account can take: same LMS, same Moodle site and a course the student is enrolled in. */
export function rows_for_student<T extends CatalogRowKey>(rows: T[], link: LinkState | undefined, courses: MoodleCourses | undefined): T[] {
  if (link?.linked && link.lms === 'demo') return rows.filter((r) => r.lms_kind === 'demo');
  if (!courses?.linked || !courses.course_ids) return [];
  const enrolled = new Set(courses.course_ids);
  return rows.filter((r) => r.lms_kind === 'moodle' && same_site(r.site, courses.site) &&
    r.course_id !== undefined && enrolled.has(r.course_id));
}
