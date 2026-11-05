import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keccak256, toBytes } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { normalize_site, type Env } from '../src/config.ts';
import worker from '../src/index.ts';
import { link_message } from '../src/link.ts';
import { get_link } from '../src/store.ts';
import { make_memory_kv } from './support/kv.ts';

const SITE = 'https://courses.ctda.hcmus.edu.vn';
const USERID = 12345;

function make_env(kv: ReturnType<typeof make_memory_kv>): Env {
  return {
    STATE: kv,
    EVIDENCE: {},
    CHAIN_ID: '43113',
    RPC_URL: 'http://127.0.0.1:1',
    MANAGER_ADDRESS: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
    DEPLOY_BLOCK: '0',
    ALLOWED_ORIGINS: '',
    MOODLE_SITES: SITE,
    FAUCET_AMOUNT_WEI: '1',
    FAUCET_DAILY_CAP: '1',
    ORACLE_PRIVATE_KEY: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    TOKEN_ENC_KEY: Buffer.from(new Uint8Array(32).fill(1)).toString('base64'),
    PRIVY_APP_ID: 'test',
  } as unknown as Env;
}

/** Links a wallet the way the web does: the wallet signs the site exactly as the user typed it. */
async function link(kv: ReturnType<typeof make_memory_kv>, site: string, account = privateKeyToAccount(generatePrivateKey())) {
  const issued_at = Math.floor(Date.now() / 1000);
  const signature = await account.signMessage({ message: link_message(account.address, 'moodle', site, issued_at) });
  const body = { wallet: account.address, lms: 'moodle', site, moodle_token: 'token', signature, issued_at };
  const res = await worker.fetch(new Request('https://oracle.test/link', { method: 'POST', body: JSON.stringify(body) }), make_env(kv));
  return { res, wallet: account.address };
}

describe('one Moodle account binds to one wallet, however the site is typed', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ userid: USERID }), { status: 200, headers: { 'content-type': 'application/json' } }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('refuses a second wallet using the same site', async () => {
    const kv = make_memory_kv();
    expect((await link(kv, SITE)).res.status).toBe(200);
    expect((await link(kv, SITE)).res.status).toBe(409);
  });

  it.each([`${SITE}/`, `${SITE}//`])('refuses a second wallet that adds trailing slashes: %s', async (variant) => {
    const kv = make_memory_kv();
    expect((await link(kv, SITE)).res.status).toBe(200);
    const second = await link(kv, variant);
    expect(second.res.status).toBe(409);
    expect(((await second.res.json()) as { error: { code: string } }).error.code).toBe('subject_taken');
  });

  it('refuses the plain site after a first link with a slash', async () => {
    const kv = make_memory_kv();
    expect((await link(kv, `${SITE}/`)).res.status).toBe(200);
    expect((await link(kv, SITE)).res.status).toBe(409);
  });

  it('stores one canonical site and subject, and still accepts a signature over the typed site', async () => {
    const kv = make_memory_kv();
    const { res, wallet } = await link(kv, `${SITE}/`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { site: string }).site).toBe(SITE);
    const stored = await get_link(kv, wallet);
    expect(stored?.site).toBe(SITE);
    expect(stored?.subject_hash).toBe(keccak256(toBytes(`${SITE}|${USERID}`)));
  });

  it('lets the same wallet relink with a slash', async () => {
    const kv = make_memory_kv();
    const account = privateKeyToAccount(generatePrivateKey());
    expect((await link(kv, SITE, account)).res.status).toBe(200);
    // issued_at is in the replay key, and the two messages differ by the site, so this is not a replay.
    expect((await link(kv, `${SITE}/`, account)).res.status).toBe(200);
  });

  it('still rejects a site outside the allowlist', async () => {
    const res = (await link(make_memory_kv(), 'https://evil.example/')).res;
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('site_not_allowed');
  });
});

describe('normalize_site', () => {
  it('removes trailing slashes only', () => {
    expect(normalize_site(`${SITE}///`)).toBe(SITE);
    expect(normalize_site(SITE)).toBe(SITE);
    expect(normalize_site('https://a.example/moodle/')).toBe('https://a.example/moodle');
    expect(normalize_site('demo')).toBe('demo');
  });
});
