import { SignJWT, jwtVerify } from 'jose';
import { ApiError } from './http.ts';

export const SESSION_TTL_SECONDS = 5 * 60;
export const SESSION_ASSERTION_TTL_SECONDS = 2 * 60;
const SESSION_CLOCK_SKEW_SECONDS = 30;
const SESSION_ISSUER = 'StudyStake Moodle session';

export function session_message(wallet: string, origin: string, issued_at: number): string {
  return `${SESSION_ISSUER}\nwallet: ${wallet.toLowerCase()}\norigin: ${origin}\nissued_at: ${issued_at}`;
}

function session_key(secret: string): Uint8Array {
  if (!secret?.trim()) throw new Error('TOKEN_ENC_KEY is required for Moodle wallet sessions');
  return new TextEncoder().encode(`${SESSION_ISSUER}\0${secret}`);
}

export function check_session_assertion(issued_at: number, now: number): void {
  if (issued_at > now + SESSION_CLOCK_SKEW_SECONDS) throw new ApiError(401, 'future', 'session signature issued in the future');
  if (issued_at < now - SESSION_ASSERTION_TTL_SECONDS) throw new ApiError(401, 'expired', 'session signature expired');
}

export async function issue_session(wallet: string, origin: string, issued_at: number, secret: string) {
  const expires_at = issued_at + SESSION_TTL_SECONDS;
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(SESSION_ISSUER)
    .setAudience(origin)
    .setSubject(wallet.toLowerCase())
    .setIssuedAt(issued_at)
    .setExpirationTime(expires_at)
    .sign(session_key(secret));
  return { token, expires_at };
}

export async function require_session(req: Request, wallet: string, now: number, secret: string): Promise<void> {
  const bearer = req.headers.get('authorization')?.match(/^Bearer ([\w.-]{1,1024})$/i)?.[1];
  if (!bearer) throw new ApiError(401, 'session_required', 'Moodle access requires a wallet session');
  try {
    await jwtVerify(bearer, session_key(secret), {
      algorithms: ['HS256'],
      issuer: SESSION_ISSUER,
      audience: new URL(req.url).origin,
      subject: wallet.toLowerCase(),
      requiredClaims: ['exp', 'iat'],
      currentDate: new Date(now * 1000),
    });
  } catch {
    throw new ApiError(401, 'session_invalid', 'Moodle wallet session is invalid or expired');
  }
}
