// Wallet <-> LMS link verification. Pure message builders plus signature checking via viem.
import { verifyMessage } from 'viem';
import { z } from 'zod';

export const LINK_MAX_SKEW_SECONDS = 600;

export const link_body_schema = z.strictObject({
  wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  lms: z.enum(['moodle', 'demo']),
  site: z.string().min(1).max(200),
  moodle_token: z.string().min(1).max(512).optional(),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/).max(260),
  issued_at: z.number().int().positive(),
});
export type LinkBody = z.infer<typeof link_body_schema>;

export function link_message(wallet: string, lms: string, site: string, issued_at: number): string {
  return `StudyStake link\nwallet: ${wallet.toLowerCase()}\nlms: ${lms}\nsite: ${site}\nissued_at: ${issued_at}`;
}

export function demo_submit_message(wallet: string, challenge_id: number, instance_id: number, issued_at: number): string {
  return `StudyStake demo submit\nwallet: ${wallet.toLowerCase()}\nchallenge: ${challenge_id}\ninstance: ${instance_id}\nissued_at: ${issued_at}`;
}

export function consent_message(wallet: string, share: boolean, issued_at: number): string {
  return `StudyStake credential consent\nwallet: ${wallet.toLowerCase()}\nshare: ${share}\nissued_at: ${issued_at}`;
}

export type VerifyFailure = 'expired' | 'future' | 'bad_signature' | 'replay';

/** Checks the freshness window only. Pure, takes `now` as input. */
export function check_issued_at(issued_at: number, now_seconds: number): VerifyFailure | null {
  if (issued_at > now_seconds + LINK_MAX_SKEW_SECONDS) return 'future';
  if (now_seconds - issued_at > LINK_MAX_SKEW_SECONDS) return 'expired';
  return null;
}

/** Returns true when signature recovers to `wallet` for `message`. */
export async function signature_matches(wallet: string, message: string, signature: string): Promise<boolean> {
  try {
    return await verifyMessage({
      address: wallet as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
  } catch {
    return false;
  }
}

/** Nonce key for replay protection. Stored in KV with a TTL longer than the freshness window. */
export function nonce_key(wallet: string, lms: string, site: string, issued_at: number, purpose: string): string {
  return `nonce:${purpose}:${wallet.toLowerCase()}:${lms}:${site}:${issued_at}`;
}

export const NONCE_TTL_SECONDS = LINK_MAX_SKEW_SECONDS * 2;
