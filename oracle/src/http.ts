// HTTP helpers: CORS allowlist, JSON errors, body size limit, zod parsing.
import { z } from 'zod';

export const MAX_BODY_BYTES = 16 * 1024;
/** Only PUT /evidence/:id uses this larger cap. */
export const MAX_EVIDENCE_BYTES = 1024 * 1024;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** Returns the origin only when it is in the allowlist. Comma-separated list in ALLOWED_ORIGINS. */
export function allowed_origin(origin: string | null, allowed_csv: string): string | null {
  if (!origin) return null;
  const list = allowed_csv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.includes(origin) ? origin : null;
}

export function cors_headers(origin: string | null, allowed_csv: string): Record<string, string> {
  const ok = allowed_origin(origin, allowed_csv);
  const headers: Record<string, string> = {
    vary: 'Origin',
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-max-age': '600',
  };
  if (ok) headers['access-control-allow-origin'] = ok;
  return headers;
}

export function json_response(
  body: unknown,
  status: number,
  extra_headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extra_headers },
  });
}

export function error_response(err: unknown, extra_headers: Record<string, string> = {}): Response {
  if (err instanceof ApiError) {
    return json_response({ error: { code: err.code, message: err.message } }, err.status, extra_headers);
  }
  return json_response({ error: { code: 'internal', message: 'internal error' } }, 500, extra_headers);
}

/** Reads the body as text with a byte cap, then parses JSON and validates with zod. */
export async function read_json<T extends z.ZodType>(
  req: Request,
  schema: T,
  max_bytes: number = MAX_BODY_BYTES,
): Promise<z.infer<T>> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > max_bytes) throw new ApiError(413, 'body_too_large', `body exceeds ${max_bytes} bytes`);
  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > max_bytes) {
    throw new ApiError(413, 'body_too_large', `body exceeds ${max_bytes} bytes`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ApiError(400, 'bad_json', 'body is not valid JSON');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(400, 'invalid_body', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  return parsed.data as z.infer<T>;
}

export function client_ip(req: Request): string {
  return req.headers.get('cf-connecting-ip') ?? '0.0.0.0';
}
