// x402 v2 payment plumbing for the paid credential route. Written by hand on purpose, with no @x402 import in the
// Worker (docs/X402.md section 12). test/x402.test.ts runs the real @x402 client against it, so format drift fails there.
import type { X402Config } from './config.ts';
import { ApiError } from './http.ts';
import type { KvLike } from './lms/demo.ts';
import { get_json, put_json } from './store.ts';

export const X402_VERSION = 2;
export const MAX_PAYMENT_HEADER_BYTES = 8 * 1024;
const VERIFY_TIMEOUT_MS = 15_000;
// Settling waits for an on-chain receipt.
const SETTLE_TIMEOUT_MS = 60_000;
const STATS_KEY = 'x402:stats';

export interface PaymentRequirements {
  scheme: 'exact';
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: { name: string; version: string };
}

export interface VerifyResult {
  isValid: boolean;
  invalidReason?: string;
}

export interface SettleResult {
  success: boolean;
  errorReason?: string;
  transaction: string;
  network?: string;
  payer?: string;
}

export interface X402Stats {
  settled_count: number;
  settled_amount: string;
}

/**
 * What a buyer must pay. Always built here from our own config, never from the buyer's `accepted` field, so a buyer
 * cannot sign for a smaller amount or another recipient. name and version are the token's EIP-712 domain.
 */
export function build_requirements(x402: X402Config, chain_id: number, pay_to: string): PaymentRequirements {
  return {
    scheme: 'exact',
    network: `eip155:${chain_id}`,
    asset: x402.asset,
    amount: x402.price,
    payTo: pay_to,
    maxTimeoutSeconds: 120,
    extra: { name: 'USD Coin', version: '2' },
  };
}

/** x402 headers carry base64 of the JSON. btoa only takes bytes, so go through UTF-8. */
export function encode_header(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
}

/** Returns the decoded payload, or null when the header is not base64 of a JSON object. */
export function decode_payment_header(header: string): Record<string, unknown> | null {
  try {
    const bytes = Uint8Array.from(atob(header), (c) => c.charCodeAt(0));
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Clients read PAYMENT-REQUIRED, not the body. `error` tells the buyer why an earlier attempt was refused. */
export function payment_required_response(url: string, requirements: PaymentRequirements, error: string): Response {
  const required = {
    x402Version: X402_VERSION,
    error,
    resource: { url, description: 'Signed StudyStake study credential', mimeType: 'application/json' },
    accepts: [requirements],
  };
  return new Response(JSON.stringify({ error: { code: 'payment_required', message: error } }), {
    status: 402,
    headers: { 'content-type': 'application/json; charset=utf-8', 'payment-required': encode_header(required), 'cache-control': 'no-store' },
  });
}

/**
 * Asks the facilitator one question. Returns null when there is no usable answer. Facilitators may answer a refusal
 * with a 4xx and the same JSON, so the body decides, but a yes is only believed from a 2xx.
 */
async function ask_facilitator(
  x402: X402Config,
  path: '/verify' | '/settle',
  answer_field: 'isValid' | 'success',
  payload: unknown,
  requirements: PaymentRequirements,
  timeout_ms: number,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${x402.facilitator_url}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x402Version: X402_VERSION, paymentPayload: payload, paymentRequirements: requirements }),
      signal: AbortSignal.timeout(timeout_ms),
    });
    const body = JSON.parse(await res.text()) as Record<string, unknown> | null;
    const answer = body?.[answer_field];
    if (typeof answer !== 'boolean' || (answer && !res.ok)) return null;
    return body;
  } catch {
    return null;
  }
}

export async function verify_payment(x402: X402Config, payload: unknown, requirements: PaymentRequirements): Promise<VerifyResult> {
  const body = await ask_facilitator(x402, '/verify', 'isValid', payload, requirements, VERIFY_TIMEOUT_MS);
  if (body === null) throw new ApiError(502, 'upstream_error', 'payment facilitator is unavailable; you were not charged');
  return body as unknown as VerifyResult;
}

/**
 * Without an answer the transfer may still land, so this does not claim the buyer was not charged. Retrying is not
 * safe either: a settle that looks failed may have moved the money.
 */
export async function settle_payment(x402: X402Config, payload: unknown, requirements: PaymentRequirements): Promise<SettleResult> {
  const body = await ask_facilitator(x402, '/settle', 'success', payload, requirements, SETTLE_TIMEOUT_MS);
  if (body === null || (body.success === true && typeof body.transaction !== 'string')) {
    throw new ApiError(502, 'settlement_unknown', 'no answer from the facilitator; check your wallet before paying again');
  }
  return body as unknown as SettleResult;
}

export async function read_stats(kv: KvLike): Promise<X402Stats> {
  return (await get_json<X402Stats>(kv, STATS_KEY)) ?? { settled_count: 0, settled_amount: '0' };
}

/** Best effort, since KV is not atomic and on-chain transfers are the real record. Never fails a paid request. */
export async function record_settlement(kv: KvLike, amount: string): Promise<void> {
  try {
    const stats = await read_stats(kv);
    await put_json(kv, STATS_KEY, { settled_count: stats.settled_count + 1, settled_amount: (BigInt(stats.settled_amount) + BigInt(amount)).toString() });
  } catch (err) {
    console.log(JSON.stringify({ event: 'x402_stats_failed', message: err instanceof Error ? err.message : String(err) }));
  }
}
