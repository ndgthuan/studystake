import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Env } from '../src/config.ts';
import worker from '../src/index.ts';
import { link_message } from '../src/link.ts';
import { issue_session } from '../src/session.ts';
import { get_link } from '../src/store.ts';
import { make_memory_kv } from './support/kv.ts';

const SITE = 'https://courses.ctda.hcmus.edu.vn';
const KEY = Buffer.from(new Uint8Array(32).fill(1)).toString('base64');

function make_env(kv: ReturnType<typeof make_memory_kv>): Env {
  return {
    STATE: kv, EVIDENCE: {}, CHAIN_ID: '43113', RPC_URL: 'http://127.0.0.1:1',
    MANAGER_ADDRESS: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9', DEPLOY_BLOCK: '0', ALLOWED_ORIGINS: '',
    MOODLE_SITES: SITE, FAUCET_AMOUNT_WEI: '1', FAUCET_DAILY_CAP: '1',
    ORACLE_PRIVATE_KEY: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    TOKEN_ENC_KEY: KEY, PRIVY_APP_ID: 'test',
  } as unknown as Env;
}

let courses_reply: unknown;
let calls: string[];

beforeEach(() => {
  calls = [];
  courses_reply = [{ id: 7, fullname: 'Cơ sở lập trình' }, { id: 3 }, { id: 7 }];
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    const fn = new URLSearchParams(String(init.body)).get('wsfunction')!;
    calls.push(fn);
    const body = fn === 'core_enrol_get_users_courses' ? courses_reply : { userid: 12345 };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
});
afterEach(() => vi.unstubAllGlobals());

async function linked_wallet(kv: ReturnType<typeof make_memory_kv>) {
  const account = privateKeyToAccount(generatePrivateKey());
  const issued_at = Math.floor(Date.now() / 1000);
  const signature = await account.signMessage({ message: link_message(account.address, 'moodle', SITE, issued_at) });
  const body = { wallet: account.address, lms: 'moodle', site: SITE, moodle_token: 'token', signature, issued_at };
  const res = await worker.fetch(new Request('https://oracle.test/link', { method: 'POST', body: JSON.stringify(body) }), make_env(kv));
  expect(res.status).toBe(200);
  return account.address;
}

async function courses(kv: ReturnType<typeof make_memory_kv>, wallet: string, session = true) {
  const now = Math.floor(Date.now() / 1000);
  const headers: Record<string, string> = {};
  if (session) headers.authorization = `Bearer ${(await issue_session(wallet, 'https://oracle.test', now, KEY)).token}`;
  return worker.fetch(new Request('https://oracle.test/moodle/courses', { method: 'POST', headers, body: JSON.stringify({ wallet }) }), make_env(kv));
}

describe('POST /moodle/courses', () => {
  it('returns the sorted, unique course ids of the linked account', async () => {
    const kv = make_memory_kv();
    const wallet = await linked_wallet(kv);
    const res = await courses(kv, wallet);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ linked: true, site: SITE, course_ids: [3, 7] });
    expect(calls).toContain('core_enrol_get_users_courses');
  });

  it('requires a wallet session', async () => {
    const kv = make_memory_kv();
    const wallet = await linked_wallet(kv);
    expect((await courses(kv, wallet, false)).status).toBe(401);
  });

  it('reports an unlinked wallet and a wiped token without calling Moodle', async () => {
    const kv = make_memory_kv();
    const stranger = privateKeyToAccount(generatePrivateKey()).address;
    expect(await (await courses(kv, stranger)).json()).toEqual({ linked: false });

    const wallet = await linked_wallet(kv);
    const stored = await get_link(kv, wallet);
    await kv.put(`link:${wallet.toLowerCase()}`, JSON.stringify({ ...stored, token_enc: null }));
    calls = [];
    expect(await (await courses(kv, wallet)).json()).toEqual({ linked: false, site: SITE, cleared: true });
    expect(calls).toEqual([]);
  });

  it('maps a rejected token to link_broken', async () => {
    const kv = make_memory_kv();
    const wallet = await linked_wallet(kv);
    courses_reply = { exception: 'moodle_exception', errorcode: 'invalidtoken' };
    const res = await courses(kv, wallet);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'link_broken' } });
  });
});
