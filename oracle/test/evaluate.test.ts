import { describe, expect, it } from 'vitest';
import { evaluate_participant, type ActivityOutcome } from '../src/evaluate.ts';

const JOIN = 1_000;
const END = 5_000;
const ok_act = (instance_id: number, due: number, time_finished: number | null, grade: number | null = null): ActivityOutcome => ({
  instance_id,
  due,
  ok: true,
  status: {
    submitted: time_finished !== null,
    finished_times: time_finished === null ? [] : [time_finished],
    finished_grades: time_finished === null ? [] : [grade],
    raw_status: 'x',
  },
});
/** Activity with several finished attempts (times and grades in parallel). */
const multi_act = (instance_id: number, due: number, times: number[], grades: (number | null)[] = times.map(() => null)): ActivityOutcome => ({
  instance_id,
  due,
  ok: true,
  status: { submitted: times.length > 0, finished_times: times, finished_grades: grades, raw_status: 'finished' },
});

const base = { account: '0xabc', stake: 100n, joined_at: JOIN, end_time: END, min_grade: null, linked: true };

describe('evaluate_participant', () => {
  it('completes when all activities are submitted in window', () => {
    const r = evaluate_participant({ ...base, activities: [ok_act(1, 4000, 2000), ok_act(2, 4500, 3000)] });
    expect(r.completed).toBe(true);
    expect(r.reason).toBe('ok');
  });

  it('reason not_linked when no link', () => {
    const r = evaluate_participant({ ...base, linked: false, activities: [ok_act(1, 4000, 2000)] });
    expect(r).toMatchObject({ completed: false, reason: 'not_linked' });
    expect(r.activities[0]!.reason).toBe('not_linked');
  });

  it('reason link_broken wins over other failures', () => {
    const r = evaluate_participant({
      ...base,
      activities: [
        { instance_id: 1, due: 4000, ok: false, code: 'link_broken' },
        ok_act(2, 4000, 9999),
      ],
    });
    expect(r).toMatchObject({ completed: false, reason: 'link_broken' });
  });

  it('reason lms_error when an activity hit a network or 5xx error', () => {
    const r = evaluate_participant({
      ...base,
      activities: [{ instance_id: 1, due: 4000, ok: false, code: 'lms_error' }, ok_act(2, 4000, 2000)],
    });
    expect(r).toMatchObject({ completed: false, reason: 'lms_error' });
  });

  it('reason missing when not submitted', () => {
    const r = evaluate_participant({ ...base, activities: [ok_act(1, 4000, null)] });
    expect(r).toMatchObject({ completed: false, reason: 'missing' });
  });

  it('reason before_join when finished before join', () => {
    const r = evaluate_participant({ ...base, activities: [ok_act(1, 4000, JOIN - 1)] });
    expect(r).toMatchObject({ completed: false, reason: 'before_join' });
  });

  it('reason late when after min(due, end_time)', () => {
    const past_due = evaluate_participant({ ...base, activities: [ok_act(1, 3000, 3500)] });
    expect(past_due.reason).toBe('late');
    const past_end = evaluate_participant({ ...base, activities: [ok_act(1, 9000, END + 1)] });
    expect(past_end.reason).toBe('late');
  });

  it('boundary: finishing exactly at due or end_time is on time', () => {
    expect(evaluate_participant({ ...base, activities: [ok_act(1, 3000, 3000)] }).reason).toBe('ok');
    expect(evaluate_participant({ ...base, activities: [ok_act(1, 9000, END)] }).reason).toBe('ok');
    expect(evaluate_participant({ ...base, activities: [ok_act(1, 4000, JOIN)] }).reason).toBe('ok');
  });

  it('reason low_grade when min_grade is set and grade is below or missing', () => {
    const below = evaluate_participant({ ...base, min_grade: 5, activities: [ok_act(1, 4000, 2000, 4)] });
    expect(below).toMatchObject({ completed: false, reason: 'low_grade' });
    const missing = evaluate_participant({ ...base, min_grade: 5, activities: [ok_act(1, 4000, 2000, null)] });
    expect(missing.reason).toBe('low_grade');
    const pass = evaluate_participant({ ...base, min_grade: 5, activities: [ok_act(1, 4000, 2000, 5)] });
    expect(pass.reason).toBe('ok');
  });

  it('min_grade null ignores grade entirely', () => {
    const r = evaluate_participant({ ...base, min_grade: null, activities: [ok_act(1, 4000, 2000, 0)] });
    expect(r.completed).toBe(true);
  });

  it('a single failing activity makes the participant not complete', () => {
    const r = evaluate_participant({ ...base, activities: [ok_act(1, 4000, 2000), ok_act(2, 4000, null)] });
    expect(r.completed).toBe(false);
    expect(r.reason).toBe('missing');
  });

  it('F1: a pre-join attempt plus an in-window attempt is ok (earliest in-window wins)', () => {
    const r = evaluate_participant({ ...base, activities: [multi_act(1, 4000, [JOIN - 500, 2500, 3000])] });
    expect(r).toMatchObject({ completed: true, reason: 'ok' });
    expect(r.activities[0]!.time_finished).toBe(2500);
  });

  it('F1: several in-window attempts pick the earliest one', () => {
    const r = evaluate_participant({ ...base, activities: [multi_act(1, 4000, [3500, 2000, 2600])] });
    expect(r.activities[0]!.time_finished).toBe(2000);
  });

  it('F1: all attempts before join gives before_join', () => {
    const r = evaluate_participant({ ...base, activities: [multi_act(1, 4000, [JOIN - 900, JOIN - 1])] });
    expect(r).toMatchObject({ completed: false, reason: 'before_join' });
  });

  it('F1: attempts before join plus one after deadline gives late', () => {
    const r = evaluate_participant({ ...base, activities: [multi_act(1, 3000, [JOIN - 100, 3500])] });
    expect(r).toMatchObject({ completed: false, reason: 'late' });
  });

  it('F1: in-window attempt with grade too low and a later higher grade is ok when min_grade is met', () => {
    const r = evaluate_participant({ ...base, min_grade: 5, activities: [multi_act(1, 4000, [2000, 3000], [2, 6])] });
    expect(r).toMatchObject({ completed: true, reason: 'ok' });
    expect(r.activities[0]!.grade).toBe(6);
    expect(r.activities[0]!.time_finished).toBe(3000);
  });

  it('F1: only in-window attempts all below min_grade gives low_grade', () => {
    const r = evaluate_participant({ ...base, min_grade: 5, activities: [multi_act(1, 4000, [2000, 3000], [2, 4])] });
    expect(r).toMatchObject({ completed: false, reason: 'low_grade' });
  });

  it('F1: in-window attempt without grade when min_grade is set gives low_grade', () => {
    const r = evaluate_participant({ ...base, min_grade: 5, activities: [multi_act(1, 4000, [2000], [null])] });
    expect(r.reason).toBe('low_grade');
  });

  it('F1: a below-grade in-window attempt does not hide a passing attempt after a late one', () => {
    const r = evaluate_participant({ ...base, min_grade: 5, activities: [multi_act(1, 3000, [2000, 3500], [9, 9])] });
    expect(r).toMatchObject({ completed: true, reason: 'ok' });
  });

  it('F1: no attempts gives missing', () => {
    const r = evaluate_participant({ ...base, activities: [multi_act(1, 4000, [])] });
    expect(r.reason).toBe('missing');
  });

  it('covers every reason value at least once across the suite', () => {
    const reasons = new Set<string>();
    const cases = [
      evaluate_participant({ ...base, linked: false, activities: [ok_act(1, 4000, 2000)] }),
      evaluate_participant({ ...base, activities: [{ instance_id: 1, due: 4000, ok: false, code: 'link_broken' }] }),
      evaluate_participant({ ...base, activities: [{ instance_id: 1, due: 4000, ok: false, code: 'lms_error' }] }),
      evaluate_participant({ ...base, activities: [ok_act(1, 4000, null)] }),
      evaluate_participant({ ...base, activities: [ok_act(1, 4000, JOIN - 1)] }),
      evaluate_participant({ ...base, activities: [ok_act(1, 3000, 3500)] }),
      evaluate_participant({ ...base, min_grade: 5, activities: [ok_act(1, 4000, 2000, 1)] }),
      evaluate_participant({ ...base, activities: [ok_act(1, 4000, 2000)] }),
    ];
    for (const c of cases) reasons.add(c.reason);
    expect([...reasons].sort()).toEqual(
      ['before_join', 'late', 'link_broken', 'low_grade', 'lms_error', 'missing', 'not_linked', 'ok'].sort(),
    );
  });
});
