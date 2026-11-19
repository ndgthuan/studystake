import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { signature_matches } from '../src/link.ts';
import { check_session_assertion, issue_session, require_session, SESSION_TTL_SECONDS, session_message } from '../src/session.ts';

const account = privateKeyToAccount(`0x${'01'.repeat(32)}`);
const origin = 'https://oracle.example.test';
const other_origin = 'https://other.example.test';
const now = 1_700_000_000;
const secret = 'test-key';

describe('Moodle wallet session', () => {
  it('binds the signed assertion to the wallet, oracle origin and time', async () => {
    const message = session_message(account.address, origin, now);
    const signature = await account.signMessage({ message });
    expect(await signature_matches(account.address, message, signature)).toBe(true);
    expect(await signature_matches(account.address, session_message(account.address, other_origin, now), signature)).toBe(false);
    expect(await signature_matches(account.address, session_message(account.address, origin, now + 1), signature)).toBe(false);
    expect(() => check_session_assertion(now - 121, now)).toThrow('session signature expired');
    expect(() => check_session_assertion(now + 31, now)).toThrow('session signature issued in the future');
  });

  it('rejects absent, cross-wallet, cross-origin and expired tokens', async () => {
    const { token, expires_at } = await issue_session(account.address, origin, now, secret);
    expect(expires_at).toBe(now + SESSION_TTL_SECONDS);
    const headers = { authorization: `Bearer ${token}` };
    const req = new Request(`${origin}/progress/1/${account.address}`, { headers });
    await expect(require_session(req, account.address.toLowerCase(), now, secret)).resolves.toBeUndefined();
    await expect(require_session(new Request(origin), account.address, now, secret)).rejects.toMatchObject({ code: 'session_required' });
    await expect(require_session(req, `0x${'02'.repeat(20)}`, now, secret)).rejects.toMatchObject({ code: 'session_invalid' });
    await expect(require_session(new Request(other_origin, { headers }), account.address, now, secret)).rejects.toMatchObject({ code: 'session_invalid' });
    await expect(require_session(req, account.address, expires_at, secret)).rejects.toMatchObject({ code: 'session_invalid' });
  });
});
