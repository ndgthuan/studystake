export interface ActivityRef {
  kind: 'quiz' | 'assign';
  instance_id: number;
  name: string;
  due: number;
}

export interface ActivityStatus {
  submitted: boolean;
  /** Unix seconds of every finished attempt (quiz) or the submission time (assign). Empty when not submitted. */
  finished_times: number[];
  /** Grade per entry of finished_times, same length. Null when grades were not requested or absent. */
  finished_grades: (number | null)[];
  raw_status: string;
}

/** Link information needed by an adapter. The token is only present for moodle links. challenge_id scopes demo submissions. */
export interface LinkInfo {
  lms: 'moodle' | 'demo';
  site: string;
  userid: number | null;
  wallet: string;
  token: string | null;
  challenge_id: number;
}

export type LmsErrorCode = 'invalid_token' | 'lms_error' | 'lms_client_error' | 'timeout' | 'not_linked';

export class LmsError extends Error {
  readonly code: LmsErrorCode;

  constructor(message: string, code: LmsErrorCode) {
    super(message);
    this.name = 'LmsError';
    this.code = code;
  }
}

export interface LmsAdapter {
  get_activity_status(link: LinkInfo, activity: ActivityRef): Promise<ActivityStatus>;
}
