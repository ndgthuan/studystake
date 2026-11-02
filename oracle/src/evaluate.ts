// Pure completion logic. No I/O. See docs/ORACLE.md "Evaluate".

import type { ActivityStatus } from './lms/types.ts';

export type Reason =
  | 'ok'
  | 'not_linked'
  | 'link_broken'
  | 'missing'
  | 'late'
  | 'before_join'
  | 'low_grade'
  | 'lms_error';

export type ActivityOutcome =
  | { instance_id: number; due: number; ok: true; status: ActivityStatus }
  | { instance_id: number; due: number; ok: false; code: 'link_broken' | 'lms_error' };

export interface EvaluateInput {
  account: string;
  stake: bigint;
  joined_at: number;
  end_time: number;
  min_grade: number | null;
  linked: boolean;
  activities: ActivityOutcome[];
}

export interface ActivityVerdict {
  instance_id: number;
  submitted: boolean;
  time_finished: number | null;
  grade: number | null;
  reason: Reason;
}

export interface ParticipantResult {
  account: string;
  stake: bigint;
  completed: boolean;
  reason: Reason;
  activities: ActivityVerdict[];
}

interface Attempt {
  time: number;
  grade: number | null;
}

function verdict_for(outcome_id: number, submitted: boolean, attempt: Attempt | null, reason: Reason): ActivityVerdict {
  return {
    instance_id: outcome_id,
    submitted,
    time_finished: attempt === null ? null : attempt.time,
    grade: attempt === null ? null : attempt.grade,
    reason,
  };
}

/**
 * Verdict for one activity. Uses the earliest finished attempt with joined_at <= t <= min(due, end_time)
 * that also meets min_grade (when set). Reasons when no attempt qualifies:
 *   - an in-window attempt exists but none meets min_grade  -> low_grade
 *   - no attempt in window and some attempt is after the deadline -> late
 *   - otherwise (all attempts before join)                  -> before_join
 */
export function evaluate_activity(
  outcome: ActivityOutcome,
  joined_at: number,
  end_time: number,
  min_grade: number | null,
): ActivityVerdict {
  if (!outcome.ok) return verdict_for(outcome.instance_id, false, null, outcome.code);
  const s = outcome.status;
  if (!s.submitted || s.finished_times.length === 0) return verdict_for(outcome.instance_id, false, null, 'missing');

  const window_end = Math.min(outcome.due, end_time);
  const attempts: Attempt[] = s.finished_times
    .map((time, i) => ({ time, grade: s.finished_grades[i] ?? null }))
    .sort((a, b) => a.time - b.time);
  const in_window = attempts.filter((a) => a.time >= joined_at && a.time <= window_end);
  const passing = in_window.find((a) => min_grade === null || (a.grade !== null && a.grade >= min_grade));
  if (passing !== undefined) return verdict_for(outcome.instance_id, true, passing, 'ok');
  if (in_window.length > 0) return verdict_for(outcome.instance_id, true, in_window[0]!, 'low_grade');

  const any_late = attempts.some((a) => a.time > window_end);
  return verdict_for(outcome.instance_id, true, attempts[0]!, any_late ? 'late' : 'before_join');
}

/**
 * Participant completes only when ALL activities are ok.
 * Overall reason priority: not_linked > link_broken > lms_error > first non-ok activity in order.
 */
export function evaluate_participant(input: EvaluateInput): ParticipantResult {
  const { account, stake, joined_at, end_time, min_grade, linked, activities } = input;

  if (!linked) {
    return {
      account,
      stake,
      completed: false,
      reason: 'not_linked',
      activities: activities.map((a) => ({
        instance_id: a.instance_id,
        submitted: false,
        time_finished: null,
        grade: null,
        reason: 'not_linked' as const,
      })),
    };
  }

  const verdicts = activities.map((a) => evaluate_activity(a, joined_at, end_time, min_grade));
  const reason = overall_reason(verdicts);
  return { account, stake, completed: reason === 'ok', reason, activities: verdicts };
}

function overall_reason(verdicts: ActivityVerdict[]): Reason {
  if (verdicts.some((v) => v.reason === 'link_broken')) return 'link_broken';
  if (verdicts.some((v) => v.reason === 'lms_error')) return 'lms_error';
  const first_bad = verdicts.find((v) => v.reason !== 'ok');
  return first_bad ? first_bad.reason : 'ok';
}
