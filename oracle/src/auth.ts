// Privy JWT verification via JWKS. Checks iss, aud and exp. Pure aside from the JWKS fetch.
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { ApiError } from './http.ts';

const jwks_cache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwks_for(app_id: string) {
  let set = jwks_cache.get(app_id);
  if (!set) {
    set = createRemoteJWKSet(new URL(`https://auth.privy.io/api/v1/apps/${app_id}/jwks.json`));
    jwks_cache.set(app_id, set);
  }
  return set;
}

export interface PrivyClaims extends JWTPayload {
  sub: string;
}

export async function verify_privy_jwt(authorization: string | null, app_id: string): Promise<PrivyClaims> {
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);
  if (!match) throw new ApiError(401, 'unauthorized', 'missing bearer token');
  try {
    const { payload } = await jwtVerify(match[1]!, jwks_for(app_id), {
      issuer: 'privy.io',
      audience: app_id,
      algorithms: ['ES256'],
    });
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw new Error('missing sub');
    }
    return payload as PrivyClaims;
  } catch {
    throw new ApiError(401, 'unauthorized', 'invalid token');
  }
}
