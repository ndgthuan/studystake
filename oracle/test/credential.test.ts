import { describe, expect, it } from 'vitest';
import { hashTypedData, keccak256, recoverTypedDataAddress, toBytes } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
  build_credential,
  consent_key,
  credential_typed_data,
  CREDENTIAL_TTL_SECONDS,
  is_shared,
  issue_credential,
  read_share_state,
  write_consent,
  type ConsentRecord,
} from '../src/credential.ts';
import { consent_message, signature_matches } from '../src/link.ts';
import type { LinkRecord } from '../src/store.ts';
import { link_key } from '../src/store.ts';
import worker from '../src/index.ts';
import type { Env } from '../src/config.ts';
import { make_memory_kv } from './support/kv.ts';

// The test vector from docs/X402.md. The key is Anvil's public default key #1.
const ORACLE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const ORACLE_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const MANAGER = '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9';
const SITE = 'https://courses.ctda.hcmus.edu.vn';
const WALLET = '0x90F79bf6EB2c4f870365E785982E1f101E93b906';
const SUBJECT = keccak256(toBytes(`${SITE}|12345`));
const STATS = { streak: 3, best_streak: 5, total_completed: 7, total_failed: 1 };
const NOW = 1794000000;

const link: LinkRecord = { wallet: WALLET.toLowerCase(), lms: 'moodle', site: SITE, userid: 12345, subject_hash: SUBJECT, token_enc: 'secret-token' };

describe('credential', () => {
  it('reproduces the test vector in docs/X402.md', async () => {
    expect(SUBJECT).toBe('0xa98aeb5b52f4397fcd931a1532326f9faac7085864d0ff767195c53cccd1d06a');
    const signed = await issue_credential({ link, stats: STATS, now_seconds: NOW, chain_id: 43113, manager: MANAGER, oracle_private_key: ORACLE_KEY });
    expect(signed.credential.site_hash).toBe('0x7c43f8cc8eb07260bc7a877fea2a58b10f537694ec543ecfb350c95321c0c5c2');
    expect(signed.credential.expires_at).toBe(1794604800);
    expect(hashTypedData(credential_typed_data(signed.credential, 43113, MANAGER))).toBe('0xd04fb6d370467d5491b5468ad349ef8685ed06b6284f03ecee7d1bbea07c842b');
    expect(signed.signature).toBe(
      '0xe580f50b33bc617e7a2e93c8832ea345ab0613c4a3bfbd0c2a1a6b25cbbc5c57269db0e83dfbda02b2b523d6f5840385ebce7e61422376a5d31464727e3bc3961b',
    );
    expect(signed.signer).toBe(ORACLE_ADDRESS);
    expect(signed.domain).toEqual({ name: 'StudyStake Credential', version: '1', chain_id: 43113, verifying_contract: MANAGER });
  });

  it('recovers to the signer from the JSON a buyer receives', async () => {
    const signed = await issue_credential({ link, stats: STATS, now_seconds: NOW, chain_id: 43113, manager: MANAGER, oracle_private_key: ORACLE_KEY });
    const received = JSON.parse(JSON.stringify(signed)) as typeof signed;
    const typed = credential_typed_data(received.credential, received.domain.chain_id, received.domain.verifying_contract);
    expect(await recoverTypedDataAddress({ ...typed, signature: received.signature })).toBe(ORACLE_ADDRESS);
  });

  it.each([
    ['streak', { streak: 99 }],
    ['lms', { lms: 'demo' as const }],
    ['expires_at', { expires_at: NOW + CREDENTIAL_TTL_SECONDS * 2 }],
    ['wallet', { wallet: ORACLE_ADDRESS as `0x${string}` }],
  ])('a tampered %s no longer recovers to the signer', async (_name, change) => {
    const signed = await issue_credential({ link, stats: STATS, now_seconds: NOW, chain_id: 43113, manager: MANAGER, oracle_private_key: ORACLE_KEY });
    const typed = credential_typed_data({ ...signed.credential, ...change }, 43113, MANAGER);
    expect(await recoverTypedDataAddress({ ...typed, signature: signed.signature })).not.toBe(ORACLE_ADDRESS);
  });

  it('a signature does not carry over to another chain or manager', async () => {
    const signed = await issue_credential({ link, stats: STATS, now_seconds: NOW, chain_id: 43113, manager: MANAGER, oracle_private_key: ORACLE_KEY });
    const other_chain = credential_typed_data(signed.credential, 43114, MANAGER);
    expect(await recoverTypedDataAddress({ ...other_chain, signature: signed.signature })).not.toBe(ORACLE_ADDRESS);
    const other_manager = credential_typed_data(signed.credential, 43113, ORACLE_ADDRESS);
    expect(await recoverTypedDataAddress({ ...other_manager, signature: signed.signature })).not.toBe(ORACLE_ADDRESS);
  });

  it('never carries the token or the raw userid', () => {
    const text = JSON.stringify(build_credential(link, STATS, NOW));
    expect(text).not.toContain('secret-token');
    expect(text).not.toContain('12345');
    expect(text).not.toContain('userid');
    expect(text).not.toContain('token');
  });

  it('checksums the wallet', () => {
    expect(build_credential(link, STATS, NOW).wallet).toBe(WALLET);
  });
});

describe('consent rules', () => {
  const on: ConsentRecord = { share: true, subject_hash: SUBJECT, updated_at: NOW };

  it('is off without a record or without a link', () => {
    expect(is_shared(null, link)).toBe(false);
    expect(is_shared(on, null)).toBe(false);
  });

  it('is on only when share is true for the current subject', () => {
    expect(is_shared(on, link)).toBe(true);
    expect(is_shared({ ...on, share: false }, link)).toBe(false);
  });

  it('is voided by linking another account', () => {
    expect(is_shared(on, { ...link, subject_hash: keccak256(toBytes(`${SITE}|999`)) })).toBe(false);
  });

  it('reads the state from KV', async () => {
    const kv = make_memory_kv();
    expect(await read_share_state(kv, WALLET)).toEqual({ link: null, share: false });
    await kv.put(link_key(WALLET), JSON.stringify(link));
    expect((await read_share_state(kv, WALLET)).share).toBe(false);
    await write_consent(kv, link, true, NOW);
    expect((await read_share_state(kv, WALLET)).share).toBe(true);
    await write_consent(kv, link, false, NOW + 1);
    expect((await read_share_state(kv, WALLET)).share).toBe(false);
  });
});

describe('consent routes', () => {
  const user = privateKeyToAccount(generatePrivateKey());
  const wallet = user.address.toLowerCase();
  const user_link: LinkRecord = { ...link, wallet };
  const now = () => Math.floor(Date.now() / 1000);

  function make_env(kv: ReturnType<typeof make_memory_kv>): Env {
    return {
      STATE: kv,
      EVIDENCE: {},
      CHAIN_ID: '43113',
      RPC_URL: 'http://127.0.0.1:1',
      MANAGER_ADDRESS: MANAGER,
      DEPLOY_BLOCK: '0',
      ALLOWED_ORIGINS: 'http://localhost:3000',
      MOODLE_SITES: SITE,
      FAUCET_AMOUNT_WEI: '1',
      FAUCET_DAILY_CAP: '1',
      ORACLE_PRIVATE_KEY: ORACLE_KEY,
      TOKEN_ENC_KEY: Buffer.from(new Uint8Array(32).fill(1)).toString('base64'),
      PRIVY_APP_ID: 'test',
    } as unknown as Env;
  }

  async function post_consent(kv: ReturnType<typeof make_memory_kv>, share: boolean, overrides: Record<string, unknown> = {}, signer = user) {
    const issued_at = now();
    const signature = await signer.signMessage({ message: consent_message(wallet, share, issued_at) });
    const body = { wallet, share, signature, issued_at, ...overrides };
    return worker.fetch(new Request('https://oracle.test/x402/credential/consent', { method: 'POST', body: JSON.stringify(body) }), make_env(kv));
  }

  async function get_share(kv: ReturnType<typeof make_memory_kv>, target = wallet) {
    return worker.fetch(new Request(`https://oracle.test/x402/credential/${target}/consent`), make_env(kv));
  }

  it('builds the exact message the spec defines, and a wallet signature matches it', async () => {
    expect(consent_message(WALLET, true, 7)).toBe(`StudyStake credential consent\nwallet: ${WALLET.toLowerCase()}\nshare: true\nissued_at: 7`);
    const message = consent_message(wallet, false, 7);
    expect(await signature_matches(wallet, message, await user.signMessage({ message }))).toBe(true);
  });

  it('GET is false by default', async () => {
    const res = await get_share(make_memory_kv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ wallet, share: false });
  });

  it('GET rejects a malformed wallet', async () => {
    const res = await get_share(make_memory_kv(), '0x123');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('invalid_wallet');
  });

  it('POST refuses a wallet with no link', async () => {
    const res = await post_consent(make_memory_kv(), true);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('not_linked');
  });

  it('POST turns sharing on and off', async () => {
    const kv = make_memory_kv();
    await kv.put(link_key(wallet), JSON.stringify(user_link));
    const on = await post_consent(kv, true);
    expect(on.status).toBe(200);
    expect(await on.json()).toEqual({ wallet, share: true });
    expect(await (await get_share(kv)).json()).toEqual({ wallet, share: true });
    // issued_at is part of the replay key, so the second signature must differ in share.
    expect((await post_consent(kv, false)).status).toBe(200);
    expect(await (await get_share(kv)).json()).toEqual({ wallet, share: false });
  });

  it('POST refuses a signature from another wallet', async () => {
    const kv = make_memory_kv();
    await kv.put(link_key(wallet), JSON.stringify(user_link));
    const res = await post_consent(kv, true, {}, privateKeyToAccount(generatePrivateKey()));
    expect(res.status).toBe(401);
    expect(await (await get_share(kv)).json()).toEqual({ wallet, share: false });
  });

  it('POST refuses a signature made for the opposite choice', async () => {
    const kv = make_memory_kv();
    await kv.put(link_key(wallet), JSON.stringify(user_link));
    const issued_at = now();
    const opt_out = await user.signMessage({ message: consent_message(wallet, false, issued_at) });
    const res = await post_consent(kv, true, { signature: opt_out, issued_at });
    expect(res.status).toBe(401);
    expect(await (await get_share(kv)).json()).toEqual({ wallet, share: false });
  });

  it('POST refuses a replay, so an old opt-in cannot undo a later opt-out', async () => {
    const kv = make_memory_kv();
    await kv.put(link_key(wallet), JSON.stringify(user_link));
    const issued_at = now();
    const signature = await user.signMessage({ message: consent_message(wallet, true, issued_at) });
    expect((await post_consent(kv, true, { signature, issued_at })).status).toBe(200);
    expect((await post_consent(kv, false)).status).toBe(200);
    const replay = await post_consent(kv, true, { signature, issued_at });
    expect(replay.status).toBe(409);
    expect(await (await get_share(kv)).json()).toEqual({ wallet, share: false });
  });

  it('POST refuses an expired signature', async () => {
    const kv = make_memory_kv();
    await kv.put(link_key(wallet), JSON.stringify(user_link));
    const issued_at = now() - 3600;
    const signature = await user.signMessage({ message: consent_message(wallet, true, issued_at) });
    expect((await post_consent(kv, true, { signature, issued_at })).status).toBe(401);
  });

  it('DELETE /link removes consent', async () => {
    const kv = make_memory_kv();
    await kv.put(link_key(wallet), JSON.stringify(user_link));
    expect((await post_consent(kv, true)).status).toBe(200);
    const issued_at = now();
    const signature = await user.signMessage({ message: `StudyStake unlink\nwallet: ${wallet}\nissued_at: ${issued_at}` });
    const res = await worker.fetch(
      new Request('https://oracle.test/link', { method: 'DELETE', body: JSON.stringify({ wallet, signature, issued_at }) }),
      make_env(kv),
    );
    expect(res.status).toBe(200);
    expect(await kv.get(consent_key(wallet))).toBeNull();
    expect(await (await get_share(kv)).json()).toEqual({ wallet, share: false });
  });

  it('gives no credential when x402 is not configured, even with consent', async () => {
    const kv = make_memory_kv();
    await kv.put(link_key(wallet), JSON.stringify(user_link));
    expect((await post_consent(kv, true)).status).toBe(200);
    const res = await worker.fetch(new Request(`https://oracle.test/x402/credential/${wallet}`), make_env(kv));
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain('signature');
  });
});
