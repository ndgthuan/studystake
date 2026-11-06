// The paid credential route, through worker.fetch. RPC and the facilitator are faked at the fetch level, so chain.ts and
// the real request bodies run. The contract tests use the real @x402 client, so a format drift fails here, not in a demo.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } from '@x402/core/http';
import { parsePaymentRequired } from '@x402/core/schemas';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { wrapFetchWithPayment, x402Client } from '@x402/fetch';
import { decodeFunctionData, encodeFunctionResult, keccak256, parseAbi, recoverTypedDataAddress, toBytes, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { load_config, type Env } from '../src/config.ts';
import { credential_typed_data, type SignedCredential } from '../src/credential.ts';
import worker from '../src/index.ts';
import { consent_key, write_consent } from '../src/credential.ts';
import { link_key, type LinkRecord } from '../src/store.ts';
import { make_memory_kv } from './support/kv.ts';

const ORACLE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const ORACLE_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const MANAGER = '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9';
const BADGE = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0';
const TREASURY = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
const USDC = '0x5425890298aed601595a70AB815c96711a31Bc65';
const WALLET = '0x90F79bf6EB2c4f870365E785982E1f101E93b906';
const RPC_URL = 'http://rpc.test/';
const FACILITATOR = 'https://facilitator.test';
const NOW = () => Math.floor(Date.now() / 1000);
const TX = `0x${'ab'.repeat(32)}`;

const chain_abi = parseAbi([
  'function treasury() view returns (address)',
  'function badge() view returns (address)',
  'function badge_of(address) view returns (uint256)',
  'function stats_of(uint256) view returns (uint32, uint32, uint32, uint32, uint64)',
]);

const link: LinkRecord = {
  wallet: WALLET.toLowerCase(),
  lms: 'moodle',
  site: 'https://courses.ctda.hcmus.edu.vn',
  userid: 12345,
  subject_hash: keccak256(toBytes('https://courses.ctda.hcmus.edu.vn|12345')),
  token_enc: 'secret-token',
};

interface Fakes {
  chain_up: boolean;
  badge_up: boolean;
  verify: () => Response | Promise<Response>;
  settle: () => Response | Promise<Response>;
  facilitator_calls: { path: string; body: { x402Version: number; paymentPayload: unknown; paymentRequirements: { amount: string; payTo: string; asset: string } } }[];
}

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const SETTLED = { success: true, transaction: TX, network: 'eip155:43113', payer: WALLET };

function make_fakes(): Fakes {
  return { chain_up: true, badge_up: true, verify: () => json({ isValid: true, payer: WALLET }), settle: () => json(SETTLED), facilitator_calls: [] };
}

function answer_rpc(body: { id: number; method: string; params: [{ data: Hex }] }, f: Fakes): Response {
  const { functionName } = decodeFunctionData({ abi: chain_abi, data: body.params[0].data });
  const result = (value: Hex) => json({ jsonrpc: '2.0', id: body.id, result: value });
  if (functionName === 'treasury') return result(encodeFunctionResult({ abi: chain_abi, functionName, result: TREASURY }));
  if (functionName === 'badge') return result(encodeFunctionResult({ abi: chain_abi, functionName, result: BADGE }));
  if (!f.badge_up) return json({ jsonrpc: '2.0', id: body.id, error: { code: -32000, message: 'down' } });
  if (functionName === 'badge_of') return result(encodeFunctionResult({ abi: chain_abi, functionName, result: 1n }));
  return result(encodeFunctionResult({ abi: chain_abi, functionName: 'stats_of', result: [3, 5, 7, 1, 0n] }));
}

function install_fetch(f: Fakes): void {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(RPC_URL)) {
      if (!f.chain_up) throw new Error('rpc down');
      return answer_rpc(JSON.parse(String(init?.body)), f);
    }
    if (url.startsWith(FACILITATOR)) {
      const path = new URL(url).pathname;
      f.facilitator_calls.push({ path, body: JSON.parse(String(init?.body)) });
      return path === '/verify' ? f.verify() : f.settle();
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

function make_env(kv: unknown, overrides: Record<string, string> = {}): Env {
  return {
    STATE: kv,
    EVIDENCE: {},
    CHAIN_ID: '43113',
    RPC_URL,
    MANAGER_ADDRESS: MANAGER,
    DEPLOY_BLOCK: '0',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    MOODLE_SITES: link.site,
    FAUCET_AMOUNT_WEI: '1',
    FAUCET_DAILY_CAP: '1',
    ORACLE_PRIVATE_KEY: ORACLE_KEY,
    TOKEN_ENC_KEY: Buffer.from(new Uint8Array(32).fill(1)).toString('base64'),
    PRIVY_APP_ID: 'test',
    X402_FACILITATOR_URL: FACILITATOR,
    X402_ASSET: USDC,
    X402_PRICE: '5000',
    ...overrides,
  } as unknown as Env;
}

async function make_shared_kv() {
  const kv = make_memory_kv();
  await kv.put(link_key(WALLET), JSON.stringify(link));
  await write_consent(kv, link, true, NOW());
  return kv;
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const PAYLOAD = { x402Version: 2, accepted: { amount: '5000' }, payload: { signature: '0xaa' } };
const signature_header = (payload: unknown = PAYLOAD) => b64(JSON.stringify(payload));

function get(env: Env, wallet = WALLET, headers: Record<string, string> = {}) {
  return worker.fetch(new Request(`https://oracle.test/x402/credential/${wallet}`, { headers }), env);
}
const paid = (env: Env, payload?: unknown) => get(env, WALLET, { 'payment-signature': signature_header(payload) });
const error_code = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

describe('paid credential route', () => {
  let f: Fakes;
  beforeEach(() => {
    f = make_fakes();
    install_fetch(f);
  });
  afterEach(() => vi.unstubAllGlobals());

  describe('free checks, before any payment', () => {
    it('503 when x402 is not configured', async () => {
      const res = await get(make_env(await make_shared_kv(), { X402_FACILITATOR_URL: '' }));
      expect(res.status).toBe(503);
      expect(await error_code(res)).toBe('x402_disabled');
    });

    it('400 for a malformed wallet', async () => {
      const res = await get(make_env(make_memory_kv()), '0x123');
      expect(res.status).toBe(400);
      expect(await error_code(res)).toBe('invalid_wallet');
    });

    it('404 for a wallet with no link, and never contacts the facilitator', async () => {
      const res = await paid(make_env(make_memory_kv()));
      expect(res.status).toBe(404);
      expect(await error_code(res)).toBe('not_linked');
      expect(f.facilitator_calls).toEqual([]);
    });

    it('403 without consent, even with a payment attached', async () => {
      const kv = make_memory_kv();
      await kv.put(link_key(WALLET), JSON.stringify(link));
      const res = await paid(make_env(kv));
      expect(res.status).toBe(403);
      expect(await error_code(res)).toBe('credential_not_shared');
      expect(f.facilitator_calls).toEqual([]);
    });

    it('403 after opting out', async () => {
      const kv = await make_shared_kv();
      await write_consent(kv, link, false, NOW());
      expect((await paid(make_env(kv))).status).toBe(403);
    });

    it('403 after linking another account, because consent covered the old one', async () => {
      const kv = await make_shared_kv();
      await kv.put(link_key(WALLET), JSON.stringify({ ...link, subject_hash: keccak256(toBytes('other')) }));
      expect((await paid(make_env(kv))).status).toBe(403);
    });

    it('429 past the rate limit', async () => {
      const env = make_env(await make_shared_kv());
      for (let i = 0; i < 60; i++) expect((await get(env)).status).toBe(402);
      const res = await get(env);
      expect(res.status).toBe(429);
      expect(await error_code(res)).toBe('rate_limited');
    });

    it('413 for an oversized payment header', async () => {
      const res = await get(make_env(await make_shared_kv()), WALLET, { 'payment-signature': 'a'.repeat(8 * 1024 + 1) });
      expect(res.status).toBe(413);
      expect(await error_code(res)).toBe('header_too_large');
      expect(f.facilitator_calls).toEqual([]);
    });

    it('502 when the chain is down, and never contacts the facilitator', async () => {
      f.chain_up = false;
      const res = await get(make_env(await make_shared_kv()));
      expect(res.status).toBe(502);
      expect(await error_code(res)).toBe('upstream_error');
      expect(f.facilitator_calls).toEqual([]);
    });
  });

  describe('asking for payment', () => {
    it('402 with a header the real @x402 library accepts', async () => {
      const res = await get(make_env(await make_shared_kv()));
      expect(res.status).toBe(402);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const required = decodePaymentRequiredHeader(res.headers.get('payment-required')!);
      expect(parsePaymentRequired(required).success).toBe(true);
      expect(required.x402Version).toBe(2);
      expect(required.accepts[0]).toEqual({
        scheme: 'exact',
        network: 'eip155:43113',
        asset: USDC,
        amount: '5000',
        payTo: TREASURY,
        maxTimeoutSeconds: 120,
        extra: { name: 'USD Coin', version: '2' },
      });
    });

    it.each([
      ['not base64', 'not-base64!!!'],
      ['base64 of text', b64('hello')],
      ['base64 of a JSON array', b64('[1]')],
      ['base64 of null', b64('null')],
    ])('402 for a garbage header: %s', async (_name, header) => {
      const res = await get(make_env(await make_shared_kv()), WALLET, { 'payment-signature': header });
      expect(res.status).toBe(402);
      expect(decodePaymentRequiredHeader(res.headers.get('payment-required')!).error).toBe('invalid payment header');
      expect(f.facilitator_calls).toEqual([]);
    });
  });

  describe('verify', () => {
    it.each([
      ['200', 200],
      ['400', 400],
    ])('402 with the reason when refused with HTTP %s, and never settles', async (_name, status) => {
      f.verify = () => json({ isValid: false, invalidReason: 'insufficient_balance' }, status);
      const res = await paid(make_env(await make_shared_kv()));
      expect(res.status).toBe(402);
      expect(decodePaymentRequiredHeader(res.headers.get('payment-required')!).error).toBe('insufficient_balance');
      expect(f.facilitator_calls.map((c) => c.path)).toEqual(['/verify']);
    });

    it.each([
      ['a network failure', () => Promise.reject(new Error('down'))],
      ['a body that is not JSON', () => new Response('<html>bad gateway</html>', { status: 502 })],
      ['JSON with no answer', () => json({ hello: 1 })],
      ['a yes from a non-2xx', () => json({ isValid: true }, 500)],
    ])('502 upstream_error on %s, and never settles', async (_name, verify) => {
      f.verify = verify;
      const res = await paid(make_env(await make_shared_kv()));
      expect(res.status).toBe(502);
      expect(await error_code(res)).toBe('upstream_error');
      expect(f.facilitator_calls.map((c) => c.path)).toEqual(['/verify']);
    });
  });

  describe('between verify and settle', () => {
    it('502 and no charge when the badge cannot be read', async () => {
      f.badge_up = false;
      const res = await paid(make_env(await make_shared_kv()));
      expect(res.status).toBe(502);
      expect(await error_code(res)).toBe('upstream_error');
      expect(f.facilitator_calls.map((c) => c.path)).toEqual(['/verify']);
    });
  });

  describe('settle', () => {
    it('402 and no credential when the transfer fails', async () => {
      f.settle = () => json({ success: false, errorReason: 'nonce_already_used', transaction: '' });
      const res = await paid(make_env(await make_shared_kv()));
      expect(res.status).toBe(402);
      expect(decodePaymentRequiredHeader(res.headers.get('payment-required')!).error).toBe('nonce_already_used');
      expect(await res.text()).not.toContain('credential"');
    });

    it.each([
      ['a network failure', () => Promise.reject(new Error('down'))],
      ['a body that is not JSON', () => new Response('oops', { status: 500 })],
      ['success with no transaction', () => json({ success: true })],
      ['a yes from a non-2xx', () => json(SETTLED, 500)],
    ])('502 settlement_unknown on %s, with no credential and no claim of no charge', async (_name, settle) => {
      f.settle = settle;
      const res = await paid(make_env(await make_shared_kv()));
      expect(res.status).toBe(502);
      const text = await res.text();
      expect(JSON.parse(text).error.code).toBe('settlement_unknown');
      expect(text).not.toContain('not charged');
      expect(text).not.toContain('"credential"');
    });

    it('does not count a failed settlement in the stats', async () => {
      f.settle = () => json({ success: false, errorReason: 'x', transaction: '' });
      const env = make_env(await make_shared_kv());
      await paid(env);
      expect(await (await worker.fetch(new Request('https://oracle.test/x402/stats'), env)).json()).toMatchObject({ settled_count: 0, settled_amount: '0' });
    });
  });

  describe('a paid request', () => {
    it('returns a credential that recovers to the oracle, and settles exactly once', async () => {
      const res = await paid(make_env(await make_shared_kv()));
      expect(res.status).toBe(200);
      const body = (await res.json()) as SignedCredential & { transaction: string };
      expect(body.transaction).toBe(TX);
      expect(body.signer).toBe(ORACLE_ADDRESS);
      expect(body.credential).toMatchObject({ wallet: WALLET, lms: 'moodle', streak: 3, best_streak: 5, total_completed: 7, total_failed: 1 });
      const typed = credential_typed_data(body.credential, body.domain.chain_id, body.domain.verifying_contract);
      expect(await recoverTypedDataAddress({ ...typed, signature: body.signature })).toBe(ORACLE_ADDRESS);
      expect(f.facilitator_calls.map((c) => c.path)).toEqual(['/verify', '/settle']);
      expect(decodePaymentResponseHeader(res.headers.get('payment-response')!)).toMatchObject({ success: true, transaction: TX });
    });

    it('never returns the token or raw userid', async () => {
      const text = await (await paid(make_env(await make_shared_kv()))).text();
      expect(text).not.toContain('secret-token');
      expect(text).not.toContain('userid');
      expect(text).not.toContain('12345');
    });

    it('sends the facilitator our requirements, not what the buyer claims to have accepted', async () => {
      const lie = { x402Version: 2, accepted: { amount: '1', payTo: WALLET, asset: WALLET }, payload: {} };
      await paid(make_env(await make_shared_kv()), lie);
      for (const call of f.facilitator_calls) {
        expect(call.body.x402Version).toBe(2);
        expect(call.body.paymentPayload).toEqual(lie);
        expect(call.body.paymentRequirements).toMatchObject({ amount: '5000', payTo: TREASURY, asset: USDC });
      }
      expect(f.facilitator_calls).toHaveLength(2);
    });

    it('still delivers when the stats write fails, because the buyer has paid', async () => {
      const kv = await make_shared_kv();
      const flaky = { ...kv, put: async (k: string, v: string, o?: { expirationTtl?: number }) => {
        if (k === 'x402:stats') throw new Error('kv down');
        await kv.put(k, v, o);
      } };
      expect((await paid(make_env(flaky))).status).toBe(200);
    });

    it('counts settlements', async () => {
      const env = make_env(await make_shared_kv());
      await paid(env);
      await paid(env);
      const res = await worker.fetch(new Request('https://oracle.test/x402/stats'), env);
      expect(await res.json()).toEqual({ pay_to: TREASURY, asset: USDC, price: '5000', settled_count: 2, settled_amount: '10000' });
    });

    it('stops selling after consent is removed', async () => {
      const kv = await make_shared_kv();
      const env = make_env(kv);
      expect((await paid(env)).status).toBe(200);
      await kv.delete(consent_key(WALLET));
      expect((await paid(env)).status).toBe(403);
    });
  });

  describe('contract with the real @x402 client', () => {
    const asset_limit = (max: string) => ({ allowedAssets: [{ network: 'eip155:43113' as const, asset: USDC, maxAmountPerPayment: max }] });
    const via_worker = (env: Env) => (input: RequestInfo | URL, init?: RequestInit) => worker.fetch(new Request(input, init), env);

    it('@x402/fetch pays by itself and receives the credential', async () => {
      const buyer = privateKeyToAccount(generatePrivateKey());
      const client = x402Client.fromConfig({ schemes: [{ network: 'eip155:43113', client: new ExactEvmScheme(buyer) }], spendControls: asset_limit('10000') });
      const pay = wrapFetchWithPayment(via_worker(make_env(await make_shared_kv())) as typeof fetch, client);
      const res = await pay(`https://oracle.test/x402/credential/${WALLET}`);
      expect(res.status).toBe(200);
      expect(((await res.json()) as SignedCredential).signer).toBe(ORACLE_ADDRESS);
      expect(decodePaymentResponseHeader(res.headers.get('payment-response')!).transaction).toBe(TX);
      // The real client signed an EIP-3009 authorization for exactly what the route asked.
      const payload = f.facilitator_calls[0]!.body.paymentPayload as { accepted: { amount: string }; payload: { authorization: { to: string; value: string } } };
      expect(payload.accepted.amount).toBe('5000');
      expect(payload.payload.authorization).toMatchObject({ to: TREASURY, value: '5000' });
    });

    it('the header codec of the real library decodes back to the same payment', async () => {
      const seen: unknown[] = [];
      f.verify = () => json({ isValid: true });
      const payload = { x402Version: 2, accepted: { amount: '5000' }, payload: { note: 'Thuận' } };
      const res = await get(make_env(await make_shared_kv()), WALLET, { 'payment-signature': encodePaymentSignatureHeader(payload as never) });
      seen.push(f.facilitator_calls[0]!.body.paymentPayload);
      expect(res.status).toBe(200);
      expect(seen[0]).toEqual(payload);
    });

    it('a client whose spending limit is below the price refuses to pay', async () => {
      const buyer = privateKeyToAccount(generatePrivateKey());
      const client = x402Client.fromConfig({ schemes: [{ network: 'eip155:43113', client: new ExactEvmScheme(buyer) }], spendControls: asset_limit('100') });
      const pay = wrapFetchWithPayment(via_worker(make_env(await make_shared_kv())) as typeof fetch, client);
      await expect(pay(`https://oracle.test/x402/credential/${WALLET}`)).rejects.toThrow();
      expect(f.facilitator_calls).toEqual([]);
    });
  });

  it('exposes the payment headers to browsers on the allowlist', async () => {
    const env = make_env(await make_shared_kv());
    const res = await worker.fetch(new Request(`https://oracle.test/x402/credential/${WALLET}`, { headers: { origin: 'http://localhost:3000' } }), env);
    expect(res.headers.get('access-control-expose-headers')).toContain('payment-required');
    expect(res.headers.get('access-control-expose-headers')).toContain('payment-response');
    expect(res.headers.get('access-control-allow-headers')).toContain('payment-signature');
  });
});

describe('x402 config', () => {
  const base = { ...make_env({}) };

  it('is off without a facilitator', () => {
    expect(load_config({ ...base, X402_FACILITATOR_URL: '' }).x402).toBeNull();
    expect(load_config({ ...base, X402_FACILITATOR_URL: undefined }).x402).toBeNull();
  });

  it('removes a trailing slash from the facilitator URL', () => {
    expect(load_config({ ...base, X402_FACILITATOR_URL: `${FACILITATOR}/` }).x402?.facilitator_url).toBe(FACILITATOR);
  });

  it.each([
    ['a malformed asset', { X402_ASSET: '0x123' }],
    ['a missing asset', { X402_ASSET: undefined }],
    ['a zero price', { X402_PRICE: '0' }],
    ['a decimal price', { X402_PRICE: '0.005' }],
    ['a missing price', { X402_PRICE: undefined }],
  ])('refuses %s', (_name, change) => {
    expect(() => load_config({ ...base, ...change })).toThrow(/X402_/);
  });
});
