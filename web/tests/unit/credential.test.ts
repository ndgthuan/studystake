import { describe, expect, it, vi } from 'vitest';
import { keccak256, toBytes, type Address } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { credential_digest, credential_typed_data, site_hash_of, verify_credential, type SignedCredential, type VerifyDeps } from '@/lib/credential';

// The test vector from docs/X402.md, which oracle/test/credential.test.ts also reproduces. The key is Anvil's public #1.
const ORACLE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const ORACLE_ADDRESS: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const MANAGER: Address = '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9';
const SITE = 'https://courses.ctda.hcmus.edu.vn';
const VECTOR: SignedCredential = {
  credential: {
    wallet: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
    lms: 'moodle',
    subject_hash: keccak256(toBytes(`${SITE}|12345`)),
    site_hash: keccak256(toBytes(SITE)),
    streak: 3,
    best_streak: 5,
    total_completed: 7,
    total_failed: 1,
    issued_at: 1794000000,
    expires_at: 1794604800,
  },
  signature:
    '0xe580f50b33bc617e7a2e93c8832ea345ab0613c4a3bfbd0c2a1a6b25cbbc5c57269db0e83dfbda02b2b523d6f5840385ebce7e61422376a5d31464727e3bc3961b',
  domain: { name: 'StudyStake Credential', version: '1', chain_id: 43113, verifying_contract: MANAGER },
};
const LIVE = { streak: 4, best_streak: 5, total_completed: 8, total_failed: 1 };
// The response also carries these. Neither is signed, so neither may be relied on.
const RESPONSE = { ...VECTOR, signer: ORACLE_ADDRESS, transaction: `0x${'ab'.repeat(32)}` };

function deps(overrides: Partial<VerifyDeps> = {}): VerifyDeps {
  return {
    chain_id: 43113,
    manager: MANAGER,
    now_seconds: VECTOR.credential.issued_at + 60,
    expected_site: SITE,
    has_oracle_role: async (a) => a === ORACLE_ADDRESS,
    read_badge_stats: async () => LIVE,
    ...overrides,
  };
}

async function report_of(input: unknown, d: VerifyDeps = deps()) {
  const outcome = await verify_credential(JSON.stringify(input), d);
  if (!outcome.ok) throw new Error(`unexpected ${outcome.error}`);
  return outcome.report;
}

/** Signs a variant properly, so only what the test changes can make it fail. */
async function sign_variant(change: Partial<SignedCredential['credential']>, key: `0x${string}` = ORACLE_KEY, domain = VECTOR.domain): Promise<SignedCredential> {
  const unsigned = { credential: { ...VECTOR.credential, ...change }, domain };
  return { ...unsigned, signature: await privateKeyToAccount(key).signTypedData(credential_typed_data(unsigned)) };
}

describe('verify_credential', () => {
  it('reproduces the digest in docs/X402.md', () => {
    expect(credential_digest(VECTOR)).toBe('0xd04fb6d370467d5491b5468ad349ef8685ed06b6284f03ecee7d1bbea07c842b');
  });

  it('accepts the real credential and recovers the signer itself', async () => {
    const r = await report_of(RESPONSE);
    expect(r.verdict).toBe('valid');
    expect(r.signer).toBe(ORACLE_ADDRESS);
    expect(r.checks).toEqual({ signature: 'pass', deployment: 'pass', freshness: 'pass' });
    expect(r.school_matches).toBe(true);
    expect(r.live_stats).toEqual(LIVE);
  });

  it('ignores a signer field that lies', async () => {
    const liar = privateKeyToAccount(generatePrivateKey());
    const forged = await sign_variant({ streak: 99 }, generatePrivateKey());
    const r = await report_of({ ...forged, signer: ORACLE_ADDRESS }, deps({ has_oracle_role: async (a) => a === ORACLE_ADDRESS || a === undefined }));
    expect(r.verdict).toBe('invalid');
    expect(r.signer).not.toBe(ORACLE_ADDRESS);
    expect(r.signer).not.toBe(liar.address);
  });

  it.each([
    ['streak', { streak: 99 }],
    ['best_streak', { best_streak: 99 }],
    ['total_completed', { total_completed: 99 }],
    ['total_failed', { total_failed: 0 }],
    ['lms', { lms: 'demo' as const }],
    ['wallet', { wallet: ORACLE_ADDRESS }],
    ['site_hash', { site_hash: keccak256(toBytes('other')) }],
    ['subject_hash', { subject_hash: keccak256(toBytes('other')) }],
    ['expires_at', { expires_at: VECTOR.credential.expires_at + 999 }],
  ])('rejects a tampered %s', async (_field, change) => {
    const r = await report_of({ ...VECTOR, credential: { ...VECTOR.credential, ...change } });
    expect(r.verdict).toBe('invalid');
    expect(r.checks.signature).toBe('fail');
  });

  it('rejects a well-signed credential from a key without ORACLE_ROLE', async () => {
    expect((await report_of(await sign_variant({}, generatePrivateKey()))).verdict).toBe('invalid');
  });

  it('rejects a signature that cannot be recovered', async () => {
    const r = await report_of({ ...VECTOR, signature: '0x1234' });
    expect(r.verdict).toBe('invalid');
    expect(r.signer).toBeNull();
  });

  it.each([
    ['another chain', { chain_id: 43114 }],
    ['another manager', { verifying_contract: ORACLE_ADDRESS }],
    ['another domain name', { name: 'Fake' }],
    ['another version', { version: '2' }],
  ])('rejects a genuine signature made for %s', async (_name, change) => {
    const domain = { ...VECTOR.domain, ...change };
    const r = await report_of(await sign_variant({}, ORACLE_KEY, domain));
    expect(r.checks.signature).toBe('pass');
    expect(r.checks.deployment).toBe('fail');
    expect(r.verdict).toBe('invalid');
  });

  it('accepts a manager address in any letter case', async () => {
    const domain = { ...VECTOR.domain, verifying_contract: MANAGER.toLowerCase() };
    const r = await report_of(await sign_variant({}, ORACLE_KEY, domain));
    expect(r.checks.deployment).toBe('pass');
  });

  it('counts fields as attested only when the oracle signed them for this deployment', async () => {
    expect((await report_of(VECTOR)).attested).toBe(true);
    expect((await report_of(VECTOR, deps({ now_seconds: VECTOR.credential.expires_at }))).attested).toBe(true);
    expect((await report_of({ ...VECTOR, credential: { ...VECTOR.credential, streak: 99 } })).attested).toBe(false);
    expect((await report_of(VECTOR, deps({ chain_id: 1 }))).attested).toBe(false);
    expect((await report_of(VECTOR, deps({ has_oracle_role: () => Promise.reject(new Error('rpc down')) }))).attested).toBe(false);
  });

  it('calls a genuine old credential expired, exactly at expires_at', async () => {
    expect((await report_of(VECTOR, deps({ now_seconds: VECTOR.credential.expires_at - 1 }))).verdict).toBe('valid');
    const r = await report_of(VECTOR, deps({ now_seconds: VECTOR.credential.expires_at }));
    expect(r.verdict).toBe('expired');
    expect(r.checks.freshness).toBe('fail');
  });

  it('calls a forged old credential invalid, not expired', async () => {
    const r = await report_of(await sign_variant({}, generatePrivateKey()), deps({ now_seconds: VECTOR.credential.expires_at + 1 }));
    expect(r.verdict).toBe('invalid');
  });

  it('never says valid when the role cannot be read', async () => {
    const r = await report_of(VECTOR, deps({ has_oracle_role: () => Promise.reject(new Error('rpc down')) }));
    expect(r.verdict).toBe('unknown');
    expect(r.checks.signature).toBe('unknown');
  });

  it('still reports a deployment mismatch as invalid when the role cannot be read', async () => {
    const r = await report_of(VECTOR, deps({ chain_id: 1, has_oracle_role: () => Promise.reject(new Error('rpc down')) }));
    expect(r.verdict).toBe('invalid');
  });

  it('stays valid when only the live stats cannot be read', async () => {
    const r = await report_of(VECTOR, deps({ read_badge_stats: () => Promise.reject(new Error('rpc down')) }));
    expect(r.verdict).toBe('valid');
    expect(r.live_stats).toBeNull();
  });

  it('asks about the wallet in the credential', async () => {
    const read_badge_stats = vi.fn(async () => LIVE);
    await report_of(VECTOR, deps({ read_badge_stats }));
    expect(read_badge_stats).toHaveBeenCalledWith(VECTOR.credential.wallet);
  });

  describe('school', () => {
    it('matches with a trailing slash or spaces', async () => {
      expect((await report_of(VECTOR, deps({ expected_site: ` ${SITE}/ ` }))).school_matches).toBe(true);
    });

    it('reports another school without changing the verdict', async () => {
      const r = await report_of(VECTOR, deps({ expected_site: 'https://other.example' }));
      expect(r.school_matches).toBe(false);
      expect(r.verdict).toBe('valid');
    });

    it('is not compared when left empty', async () => {
      expect((await report_of(VECTOR, deps({ expected_site: '  ' }))).school_matches).toBeNull();
    });

    it('hashes the way the oracle stored it', () => {
      expect(site_hash_of(SITE)).toBe('0x7c43f8cc8eb07260bc7a877fea2a58b10f537694ec543ecfb350c95321c0c5c2');
    });
  });

  describe('input', () => {
    it('refuses text that is not JSON', async () => {
      expect(await verify_credential('hello', deps())).toEqual({ ok: false, error: 'not_json' });
    });

    it.each([
      ['null', null],
      ['an array', []],
      ['no credential', { signature: '0x', domain: VECTOR.domain }],
      ['no signature', { credential: VECTOR.credential, domain: VECTOR.domain }],
      ['no domain', { credential: VECTOR.credential, signature: VECTOR.signature }],
      ['an unknown lms', { ...VECTOR, credential: { ...VECTOR.credential, lms: 'canvas' } }],
      ['a malformed wallet', { ...VECTOR, credential: { ...VECTOR.credential, wallet: '0x12' } }],
      ['a negative streak', { ...VECTOR, credential: { ...VECTOR.credential, streak: -1 } }],
      ['a streak over uint32', { ...VECTOR, credential: { ...VECTOR.credential, streak: 2 ** 32 } }],
      ['a non-integer expiry', { ...VECTOR, credential: { ...VECTOR.credential, expires_at: 1.5 } }],
      ['an extra unsigned field', { ...VECTOR, credential: { ...VECTOR.credential, name: 'Nguyen Van A' } }],
    ])('refuses %s', async (_name, input) => {
      expect(await verify_credential(JSON.stringify(input), deps())).toEqual({ ok: false, error: 'wrong_shape' });
    });
  });
});
