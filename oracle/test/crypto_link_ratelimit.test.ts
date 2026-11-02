import { describe, expect, it } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { decrypt_token, encrypt_token } from '../src/crypto.ts';
import { check_issued_at, link_message, nonce_key, signature_matches, LINK_MAX_SKEW_SECONDS } from '../src/link.ts';
import { check_rate_limit, window_key } from '../src/ratelimit.ts';
import { make_memory_kv } from './support/kv.ts';

const KEY_B64 = Buffer.from(new Uint8Array(32).map((_, i) => i + 1)).toString('base64');

describe('crypto (AES-GCM)', () => {
  it('round-trips a token', async () => {
    const packed = await encrypt_token('moodle-token-abc', KEY_B64);
    expect(packed).not.toContain('moodle-token-abc');
    expect(await decrypt_token(packed, KEY_B64)).toBe('moodle-token-abc');
  });

  it('uses a fresh IV, so two encryptions differ', async () => {
    const a = await encrypt_token('same', KEY_B64);
    const b = await encrypt_token('same', KEY_B64);
    expect(a).not.toBe(b);
  });

  it('fails to decrypt with another key or tampered data', async () => {
    const packed = await encrypt_token('secret', KEY_B64);
    const other = Buffer.from(new Uint8Array(32).fill(9)).toString('base64');
    await expect(decrypt_token(packed, other)).rejects.toThrow();
    const [iv, ct] = packed.split('.') as [string, string];
    const flipped = ct.slice(0, -4) + (ct.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA');
    await expect(decrypt_token(`${iv}.${flipped}`, KEY_B64)).rejects.toThrow();
  });

  it('rejects a key that is not 32 bytes', async () => {
    const short = Buffer.from('abc').toString('base64');
    await expect(encrypt_token('x', short)).rejects.toThrow(/32 bytes/);
  });
});

describe('link signature verification', () => {
  const pk = generatePrivateKey();
  const account = privateKeyToAccount(pk);
  const wallet = account.address;
  const site = 'https://courses.ctda.hcmus.edu.vn';

  it('accepts a correct signature', async () => {
    const now = 1_800_000_000;
    const msg = link_message(wallet, 'moodle', site, now);
    const sig = await account.signMessage({ message: msg });
    expect(await signature_matches(wallet, msg, sig)).toBe(true);
  });

  it('rejects a signature from a different wallet', async () => {
    const other = privateKeyToAccount(generatePrivateKey());
    const msg = link_message(wallet, 'moodle', site, 1_800_000_000);
    const sig = await other.signMessage({ message: msg });
    expect(await signature_matches(wallet, msg, sig)).toBe(false);
  });

  it('rejects a signature over a different message (e.g. other site)', async () => {
    const sig = await account.signMessage({ message: link_message(wallet, 'moodle', site, 1_800_000_000) });
    const tampered = link_message(wallet, 'moodle', 'https://evil.example', 1_800_000_000);
    expect(await signature_matches(wallet, tampered, sig)).toBe(false);
  });

  it('rejects malformed signatures without throwing', async () => {
    expect(await signature_matches(wallet, 'm', '0x1234')).toBe(false);
  });

  it('freshness: current time is ok, expired and future are rejected', () => {
    const now = 1_800_000_000;
    expect(check_issued_at(now, now)).toBeNull();
    expect(check_issued_at(now - LINK_MAX_SKEW_SECONDS, now)).toBeNull();
    expect(check_issued_at(now - LINK_MAX_SKEW_SECONDS - 1, now)).toBe('expired');
    expect(check_issued_at(now + LINK_MAX_SKEW_SECONDS, now)).toBeNull();
    expect(check_issued_at(now + LINK_MAX_SKEW_SECONDS + 1, now)).toBe('future');
  });

  it('replay: nonce key is unique per signed message and blocks a second use via KV', async () => {
    const kv = make_memory_kv();
    const key = nonce_key(wallet, 'moodle', site, 1_800_000_000, 'link');
    expect(await kv.get(key)).toBeNull();
    await kv.put(key, '1');
    expect(await kv.get(key)).not.toBeNull();
    expect(nonce_key(wallet, 'moodle', site, 1_800_000_001, 'link')).not.toBe(key);
  });
});

describe('rate limit', () => {
  it('window_key buckets by window start', () => {
    expect(window_key('faucet', '1.2.3.4', 1000, 60)).toBe(window_key('faucet', '1.2.3.4', 1019, 60));
    expect(window_key('faucet', '1.2.3.4', 1000, 60)).not.toBe(window_key('faucet', '1.2.3.4', 1060, 60));
  });

  it('allows up to the limit then blocks within the same window', async () => {
    const kv = make_memory_kv();
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await check_rate_limit(kv, 'link', '9.9.9.9', 3, 60, 1000));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
  });

  it('resets in the next window and is per IP', async () => {
    const kv = make_memory_kv();
    for (let i = 0; i < 3; i++) await check_rate_limit(kv, 'link', '9.9.9.9', 3, 60, 1000);
    expect((await check_rate_limit(kv, 'link', '9.9.9.9', 3, 60, 1000)).allowed).toBe(false);
    expect((await check_rate_limit(kv, 'link', '9.9.9.9', 3, 60, 1060)).allowed).toBe(true);
    expect((await check_rate_limit(kv, 'link', '8.8.8.8', 3, 60, 1000)).allowed).toBe(true);
  });
});
