import { describe, expect, it } from 'vitest';
import { public_rows, rows_for_student } from '@/lib/catalog';
import { same_site } from '@/lib/moodle';

const SITE = 'https://courses.ctda.hcmus.edu.vn';
const rows = [
  { id: 1, lms_kind: 'demo' as const, site: 'demo', course_id: 0 },
  { id: 2, lms_kind: 'moodle' as const, site: SITE, course_id: 10 },
  { id: 3, lms_kind: 'moodle' as const, site: `${SITE}/`, course_id: 11 },
  { id: 4, lms_kind: 'moodle' as const, site: 'https://other.example', course_id: 10 },
  { id: 5, lms_kind: undefined, site: undefined, course_id: undefined },
];

describe('public_rows', () => {
  it('drops hidden pilot and test rounds', () => {
    expect(public_rows(rows, new Set([1, 2])).map((r) => r.id)).toEqual([3, 4, 5]);
    expect(public_rows(undefined, new Set())).toEqual([]);
  });
});

describe('rows_for_student', () => {
  const linked = { linked: true, lms: 'moodle' as const, site: SITE };

  it('keeps only the same Moodle site and enrolled courses', () => {
    const courses = { linked: true, site: SITE, course_ids: [11, 10] };
    expect(rows_for_student(rows, linked, courses).map((r) => r.id)).toEqual([2, 3]);
    expect(rows_for_student(rows, linked, { linked: true, site: SITE, course_ids: [11] }).map((r) => r.id)).toEqual([3]);
  });

  it('shows nothing before the course list is known or after the token was wiped', () => {
    expect(rows_for_student(rows, linked, undefined)).toEqual([]);
    expect(rows_for_student(rows, { linked: false }, { linked: false, site: SITE, cleared: true })).toEqual([]);
  });

  it('shows demo rounds to a Demo LMS link', () => {
    expect(rows_for_student(rows, { linked: true, lms: 'demo', site: 'demo' }, undefined).map((r) => r.id)).toEqual([1]);
  });
});

describe('same_site', () => {
  it('ignores case and trailing slashes', () => {
    expect(same_site(`${SITE}//`, SITE.toUpperCase())).toBe(true);
    expect(same_site(SITE, 'https://other.example')).toBe(false);
    expect(same_site(undefined, SITE)).toBe(false);
  });
});
