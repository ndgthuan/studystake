// REST client for the oracle Worker. Each function returns parsed JSON or throws with the oracle error code.
import { ORACLE_URL } from './config';

export class OracleError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'OracleError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${ORACLE_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new OracleError(res.status, err?.code ?? 'http_error', err?.message ?? `HTTP ${res.status}`);
  }
  return body as T;
}

export interface MetadataDoc {
  version: number;
  title: string;
  lms: 'moodle' | 'demo';
  site: string;
  course_id: number;
  activities: { kind: 'quiz' | 'assign'; instance_id: number; name: string; due: number }[];
  min_grade: number | null;
}

export interface LinkState {
  linked: boolean;
  lms?: 'moodle' | 'demo';
  site?: string;
}

export interface ProgressActivity {
  instance_id: number;
  kind: string;
  submitted: boolean;
  time_finished: number | null;
  status: string;
  eligible: boolean;
  reason: string;
}

export interface ProgressBody {
  challenge_id: number;
  wallet: string;
  stake: string;
  activities: ProgressActivity[];
  as_of: number;
}

export interface ProofBody {
  completed: boolean;
  stake: string;
  proof: `0x${string}`[];
}

export interface MoodleSession {
  token: string;
  expires_at: number;
}

export interface QuizPreview {
  site: string;
  course_id: number;
  instance_id: number;
  name: string;
  due: number | null;
}

export interface X402Stats {
  pay_to: `0x${string}`;
  asset: `0x${string}`;
  settled_amount: string;
  settled_count: number;
}

export const oracle = {
  get_metadata: (hash: string) => request<MetadataDoc>(`/metadata/${hash}`),
  post_metadata: (body: unknown) => request<{ metadata_hash: string; metadata_uri: string }>(`/metadata`, { method: 'POST', body: JSON.stringify(body) }),
  get_link: (wallet: string) => request<LinkState>(`/link/${wallet}`, { cache: 'no-store' }),
  post_link: (body: unknown) => request<LinkState>(`/link`, { method: 'POST', body: JSON.stringify(body) }),
  delete_link: (body: unknown) => request<{ ok: boolean }>(`/link`, { method: 'DELETE', body: JSON.stringify(body) }),
  get_consent: (wallet: string) => request<{ wallet: string; share: boolean }>(`/x402/credential/${wallet}/consent`),
  post_consent: (body: unknown) => request<{ wallet: string; share: boolean }>(`/x402/credential/consent`, { method: 'POST', body: JSON.stringify(body) }),
  get_x402_stats: () => request<X402Stats>('/x402/stats'),
  post_session: (body: { wallet: string; issued_at: number; signature: string }) =>
    request<MoodleSession>('/session', { method: 'POST', body: JSON.stringify(body) }),
  preview_quiz: (wallet: string, url: string, token: string) =>
    request<QuizPreview>('/moodle/quiz-preview', {
      method: 'POST', body: JSON.stringify({ wallet, url }),
      headers: { authorization: `Bearer ${token}` },
    }),
  check_join: (id: number, wallet: string, token: string) =>
    request<{ ok: true }>('/join/preflight', {
      method: 'POST', body: JSON.stringify({ challenge_id: id, wallet }),
      headers: { authorization: `Bearer ${token}` },
    }),
  get_progress: (id: number, wallet: string, token?: string, signal?: AbortSignal) => request<ProgressBody>(`/progress/${id}/${wallet}`, {
    signal, cache: 'no-store', headers: token ? { authorization: `Bearer ${token}` } : undefined,
  }),
  post_demo_submit: (body: unknown) => request<{ ok: boolean; submitted_at: number }>(`/demo/submit`, { method: 'POST', body: JSON.stringify(body) }),
  get_demo_activities: (id: number) =>
    request<{ label: string; lms: string; title: string; activities: MetadataDoc['activities'] }>(`/demo/activities/${id}`),
  get_evidence: (id: number) => request<Record<string, unknown>>(`/evidence/${id}`),
  get_proof: (id: number, account: string) => request<ProofBody>(`/proof/${id}/${account}`),
  post_faucet: (body: unknown, jwt: string) =>
    request<{ tx_hash: `0x${string}`; amount_wei: string }>(`/faucet`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { authorization: `Bearer ${jwt}` },
    }),
};
