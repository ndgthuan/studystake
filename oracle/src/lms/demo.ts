// Demo LMS adapter. Reads submissions stored in KV by POST /demo/submit. Labelled DEMO everywhere.
import type { ActivityRef, ActivityStatus, LinkInfo, LmsAdapter } from './types.ts';

/** Minimal KV surface, so tests and E2E can supply an in-memory shim. */
export interface KvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Scoped by challenge so a submission for one challenge cannot satisfy another that reuses the same instance_id. */
export function demo_submission_key(wallet: string, challenge_id: number, instance_id: number): string {
  return `demo:${wallet.toLowerCase()}:${challenge_id}:${instance_id}`;
}

/** Stores a Demo LMS submission time. Used by POST /demo/submit and by the E2E script. */
export async function record_demo_submission(
  kv: KvLike,
  wallet: string,
  challenge_id: number,
  instance_id: number,
  time_seconds: number,
): Promise<void> {
  await kv.put(demo_submission_key(wallet, challenge_id, instance_id), String(time_seconds));
}

/** True when instance_id is one of the challenge's activities. Used to validate POST /demo/submit. */
export function has_demo_activity(activities: { instance_id: number }[], instance_id: number): boolean {
  return activities.some((a) => a.instance_id === instance_id);
}

export function create_demo_adapter(kv: KvLike): LmsAdapter {
  return {
    async get_activity_status(link: LinkInfo, activity: ActivityRef): Promise<ActivityStatus> {
      const raw = await kv.get(demo_submission_key(link.wallet, link.challenge_id, activity.instance_id));
      if (raw === null) {
        return { submitted: false, finished_times: [], finished_grades: [], raw_status: 'demo_none' };
      }
      const time = Number(raw);
      if (!Number.isInteger(time) || time <= 0) {
        return { submitted: false, finished_times: [], finished_grades: [], raw_status: 'demo_invalid' };
      }
      // Demo submissions carry no grade. Challenges with min_grade cannot be completed through the demo LMS.
      return { submitted: true, finished_times: [time], finished_grades: [null], raw_status: 'demo_submitted' };
    },
  };
}
