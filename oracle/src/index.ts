// Worker entry: HTTP router (fetch) and cron (scheduled).
import { createPublicClient, createWalletClient, http, keccak256, toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { z } from 'zod';
import { verify_privy_jwt } from './auth.ts';
import { build_chain, chain_for, STATUS, type ChainPort, type ChallengeRow } from './chain.ts';
import { canonical_json } from './canonical.ts';
import { is_allowed_site, load_config, normalize_site, type Config, type Env } from './config.ts';
import { consent_key, read_share_state, write_consent } from './credential.ts';
import { decrypt_token, encrypt_token } from './crypto.ts';
import { run_faucet_grant, verify_turnstile } from './faucet.ts';
import { check_evidence_upload, committed_proof, is_committed, load_committed_evidence } from './evidence.ts';
import { ApiError, client_ip, cors_headers, error_response, json_response, MAX_EVIDENCE_BYTES, read_json } from './http.ts';
import {
  check_issued_at,
  consent_message,
  demo_submit_message,
  link_body_schema,
  link_message,
  nonce_key,
  NONCE_TTL_SECONDS,
  signature_matches,
} from './link.ts';
import { create_demo_adapter, has_demo_activity, record_demo_submission, type KvLike } from './lms/demo.ts';
import { create_moodle_adapter, fetch_userid } from './lms/moodle.ts';
import { LmsError, type ActivityStatus, type LinkInfo } from './lms/types.ts';
import { metadata_hash, metadata_key, parse_metadata, verify_metadata, type ChallengeMetadata } from './metadata.ts';
import { evidence_key, subject_hash_of } from './merkle.ts';
import {
  PROGRESS_CACHE_TTL_SECONDS,
  PROGRESS_RATE_LIMIT,
  PROGRESS_RATE_WINDOW_SECONDS,
  progress_cache_key,
  progress_user_error,
} from './progress.ts';
import { check_rate_limit } from './ratelimit.ts';
import { participants_of, run_settle_job, type SettleDeps } from './settle.ts';
import { get_link, get_text, put_evidence, put_json, subject_key, type LinkRecord, type R2Like, type Store } from './store.ts';

interface Runtime {
  cfg: Config;
  port: ChainPort;
  store: Store;
  public_client: ReturnType<typeof createPublicClient>;
}

function build_runtime(env: Env): Runtime {
  const cfg = load_config(env);
  const chain = chain_for(cfg);
  const transport = http(cfg.rpc_url);
  const { port, public_client } = build_chain(chain, cfg, transport);
  const store: Store = {
    kv: env.STATE as unknown as KvLike,
    r2: env.EVIDENCE as unknown as R2Like,
  };
  return { cfg, port, store, public_client };
}

function settle_deps(rt: Runtime): SettleDeps {
  return {
    port: rt.port,
    store: rt.store,
    chain_id: rt.cfg.chain_id,
    manager: rt.cfg.manager,
    deploy_block: rt.cfg.deploy_block,
    token_enc_key: rt.cfg.token_enc_key,
    decrypt_token,
    demo_adapter: create_demo_adapter(rt.store.kv),
    moodle_adapter: (want_grade) => create_moodle_adapter({ want_grade }),
    now: () => Math.floor(Date.now() / 1000),
    log: (event, data) => console.log(JSON.stringify({ event, ...data })),
  };
}

const hex_sig = z.string().regex(/^0x[0-9a-fA-F]+$/).max(260);
const wallet_schema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

const demo_submit_schema = z.strictObject({
  wallet: wallet_schema,
  challenge_id: z.number().int().positive(),
  instance_id: z.number().int().positive(),
  signature: hex_sig,
  issued_at: z.number().int().positive(),
});
const signed_schema = z.strictObject({
  wallet: wallet_schema,
  signature: hex_sig,
  issued_at: z.number().int().positive(),
});
const metadata_post_schema = z.strictObject({
  wallet: wallet_schema,
  signature: hex_sig,
  issued_at: z.number().int().positive(),
  metadata: z.unknown(),
});
const consent_schema = z.strictObject({
  wallet: wallet_schema,
  share: z.boolean(),
  signature: hex_sig,
  issued_at: z.number().int().positive(),
});
const faucet_schema = z.strictObject({
  wallet: wallet_schema,
  turnstile_token: z.string().max(2048).optional(),
});

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const cors = cors_headers(req.headers.get('origin'), env.ALLOWED_ORIGINS ?? '');
    try {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      const rt = build_runtime(env);
      const res = await route(req, rt);
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    } catch (err) {
      if (!(err instanceof ApiError)) {
        console.log(JSON.stringify({ event: 'unhandled', message: err instanceof Error ? err.message : String(err) }));
      }
      return error_response(err, cors);
    }
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const rt = build_runtime(env);
    ctx.waitUntil(
      run_settle_job(settle_deps(rt)).then((report) => console.log(JSON.stringify({ event: 'cron', ...report }))),
    );
  },
};

async function route(req: Request, rt: Runtime): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const parts = path.split('/').filter(Boolean);
  const now = Math.floor(Date.now() / 1000);

  if (req.method === 'GET' && path === '/health') {
    const block = await rt.port.block_number();
    return json_response(
      {
        ok: true,
        chain_id: rt.cfg.chain_id,
        manager: rt.cfg.manager,
        oracle_address: rt.port.oracle_address(),
        block: block.toString(),
      },
      200,
    );
  }

  if (req.method === 'POST' && path === '/metadata') {
    return handle_metadata_post(req, url, rt, now);
  }

  if (req.method === 'GET' && parts[0] === 'metadata' && parts.length === 2) {
    const text = await get_text(rt.store.r2, metadata_key(parts[1]!));
    if (text === null) throw new ApiError(404, 'not_found', 'metadata not found');
    return new Response(text, { status: 200, headers: { 'content-type': 'application/json' } });
  }

  if (req.method === 'POST' && path === '/link') return handle_link(req, rt, now);
  if (req.method === 'DELETE' && path === '/link') return handle_unlink(req, rt, now);

  if (req.method === 'GET' && parts[0] === 'link' && parts.length === 2) {
    const link = await get_link(rt.store.kv, parts[1]!);
    if (link === null) return json_response({ linked: false }, 200);
    return json_response({ lms: link.lms, site: link.site, linked: true }, 200);
  }

  if (req.method === 'POST' && path === '/demo/submit') return handle_demo_submit(req, rt, now);

  if (req.method === 'GET' && parts[0] === 'demo' && parts[1] === 'activities' && parts.length === 3) {
    const id = Number(parts[2]);
    const ch = await rt.port.get_challenge(id);
    if (ch.status === STATUS.None) throw new ApiError(404, 'not_found', 'challenge not found');
    const meta = await load_metadata_by_hash(rt, ch.metadata_hash);
    if (meta === null) throw new ApiError(404, 'not_found', 'metadata not found');
    return json_response({ label: 'DEMO', lms: meta.lms, title: meta.title, activities: meta.activities }, 200);
  }

  if (req.method === 'GET' && parts[0] === 'progress' && parts.length === 3) {
    const id = parse_challenge_id(parts[1]!);
    if (!wallet_schema.safeParse(parts[2]).success) throw new ApiError(400, 'invalid_wallet', 'wallet must be 0x + 40 hex');
    return handle_progress(req, rt, id, parts[2]!, now);
  }

  if (parts[0] === 'evidence' && parts.length === 2) {
    if (req.method === 'GET') return handle_evidence_get(rt, parse_challenge_id(parts[1]!));
    if (req.method === 'PUT') return handle_evidence_put(req, rt, parse_challenge_id(parts[1]!));
  }

  if (req.method === 'GET' && parts[0] === 'proof' && parts.length === 3) {
    if (!wallet_schema.safeParse(parts[2]).success) throw new ApiError(400, 'invalid_wallet', 'account must be 0x + 40 hex');
    return handle_proof(rt, parse_challenge_id(parts[1]!), parts[2]!);
  }

  if (req.method === 'POST' && path === '/x402/credential/consent') return handle_consent_post(req, rt, now);

  if (req.method === 'GET' && parts[0] === 'x402' && parts[1] === 'credential' && parts[3] === 'consent' && parts.length === 4) {
    if (!wallet_schema.safeParse(parts[2]).success) throw new ApiError(400, 'invalid_wallet', 'wallet must be 0x + 40 hex');
    const { share } = await read_share_state(rt.store.kv, parts[2]!);
    return json_response({ wallet: parts[2]!.toLowerCase(), share }, 200);
  }

  if (req.method === 'POST' && path === '/faucet') return handle_faucet(req, rt, now);

  throw new ApiError(404, 'not_found', 'route not found');
}

function parse_challenge_id(raw: string): number {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) throw new ApiError(400, 'invalid_challenge_id', 'challenge id must be a positive integer');
  return id;
}

function require_fresh(issued_at: number, now: number): void {
  const failure = check_issued_at(issued_at, now);
  if (failure) throw new ApiError(401, failure, `issued_at ${failure}`);
}

function require_signature(ok: boolean): void {
  if (!ok) throw new ApiError(401, 'bad_signature', 'signature does not match');
}

async function load_metadata_by_hash(rt: Runtime, hash: `0x${string}`): Promise<ChallengeMetadata | null> {
  const text = await get_text(rt.store.r2, metadata_key(hash));
  if (text === null) return null;
  const raw = JSON.parse(text) as unknown;
  if (!verify_metadata(raw, hash)) return null;
  return parse_metadata(raw);
}

async function handle_metadata_post(req: Request, url: URL, rt: Runtime, now: number): Promise<Response> {
  const body = await read_json(req, metadata_post_schema);
  require_fresh(body.issued_at, now);
  const meta = parse_metadata(body.metadata);
  const hash = metadata_hash(meta);
  const msg = `StudyStake metadata\nwallet: ${body.wallet.toLowerCase()}\nhash: ${hash}\nissued_at: ${body.issued_at}`;
  require_signature(await signature_matches(body.wallet, msg, body.signature));
  if (!(await rt.port.has_creator_role(body.wallet))) {
    throw new ApiError(403, 'not_creator', 'wallet lacks CREATOR_ROLE');
  }
  await rt.store.r2.put(metadata_key(hash), canonical_json(meta), {
    httpMetadata: { contentType: 'application/json' },
  });
  return json_response({ metadata_hash: hash, metadata_uri: `${url.origin}/metadata/${hash}` }, 201);
}

async function handle_link(req: Request, rt: Runtime, now: number): Promise<Response> {
  const body = await read_json(req, link_body_schema);
  require_fresh(body.issued_at, now);
  if (body.lms === 'moodle') {
    if (!body.moodle_token) throw new ApiError(400, 'invalid_body', 'moodle_token required');
    if (!is_allowed_site(body.site, rt.cfg)) throw new ApiError(400, 'site_not_allowed', 'site not in allowlist');
  }
  const msg = link_message(body.wallet, body.lms, body.site, body.issued_at);
  require_signature(await signature_matches(body.wallet, msg, body.signature));

  // Replay protection: the same signed message can be used once.
  const nonce = nonce_key(body.wallet, body.lms, body.site, body.issued_at, 'link');
  if ((await rt.store.kv.get(nonce)) !== null) throw new ApiError(409, 'replay', 'signature already used');
  await rt.store.kv.put(nonce, '1', { expirationTtl: NONCE_TTL_SECONDS });

  // The wallet signed the site as typed. Everything stored or hashed uses the canonical spelling.
  const site = normalize_site(body.site);
  const wallet = body.wallet.toLowerCase();
  let userid: number | null = null;
  let subject_hash: string;
  let token_enc: string | null = null;
  if (body.lms === 'moodle') {
    const token = body.moodle_token!;
    userid = await fetch_userid(site, token);
    subject_hash = subject_hash_of(site, userid);
    token_enc = await encrypt_token(token, rt.cfg.token_enc_key);
  } else {
    subject_hash = keccak256(toBytes(`demo|${wallet}`));
  }

  const subject_k = subject_key(subject_hash);
  const owner = await rt.store.kv.get(subject_k);
  if (owner !== null && owner.toLowerCase() !== wallet) {
    throw new ApiError(409, 'subject_taken', 'this LMS account is already linked to another wallet');
  }

  const previous = await get_link(rt.store.kv, wallet);
  if (previous !== null && previous.subject_hash !== subject_hash) {
    if (await has_open_challenge_for(rt, wallet)) {
      throw new ApiError(409, 'open_challenge', 'wallet has an open challenge; cannot change LMS account');
    }
    await rt.store.kv.delete(subject_key(previous.subject_hash));
  }

  await rt.store.kv.put(subject_k, wallet);
  const record: LinkRecord = { wallet, lms: body.lms, site, userid, subject_hash, token_enc };
  await put_json(rt.store.kv, `link:${wallet}`, record);
  return json_response({ lms: body.lms, site, linked: true }, 200);
}

async function handle_unlink(req: Request, rt: Runtime, now: number): Promise<Response> {
  const body = await read_json(req, signed_schema);
  require_fresh(body.issued_at, now);
  const msg = `StudyStake unlink\nwallet: ${body.wallet.toLowerCase()}\nissued_at: ${body.issued_at}`;
  require_signature(await signature_matches(body.wallet, msg, body.signature));
  const wallet = body.wallet.toLowerCase();
  const link = await get_link(rt.store.kv, wallet);
  if (link !== null) {
    await put_json(rt.store.kv, `link:${wallet}`, { ...link, token_enc: null });
  }
  await rt.store.kv.delete(consent_key(wallet));
  return json_response({ ok: true }, 200);
}

/** The student opts in or out of selling their credential. Both directions need a fresh, single-use wallet signature. */
async function handle_consent_post(req: Request, rt: Runtime, now: number): Promise<Response> {
  const limited = await check_rate_limit(rt.store.kv, 'consent', client_ip(req), 20, 60, now);
  if (!limited.allowed) throw new ApiError(429, 'rate_limited', 'too many requests');
  const body = await read_json(req, consent_schema);
  require_fresh(body.issued_at, now);
  require_signature(await signature_matches(body.wallet, consent_message(body.wallet, body.share, body.issued_at), body.signature));

  const nonce = nonce_key(body.wallet, 'credential', String(body.share), body.issued_at, 'consent');
  if ((await rt.store.kv.get(nonce)) !== null) throw new ApiError(409, 'replay', 'signature already used');
  await rt.store.kv.put(nonce, '1', { expirationTtl: NONCE_TTL_SECONDS });

  const link = await get_link(rt.store.kv, body.wallet);
  if (link === null) throw new ApiError(404, 'not_linked', 'wallet has no LMS link');
  await write_consent(rt.store.kv, link, body.share, now);
  return json_response({ wallet: body.wallet.toLowerCase(), share: body.share }, 200);
}

async function handle_demo_submit(req: Request, rt: Runtime, now: number): Promise<Response> {
  const limited = await check_rate_limit(rt.store.kv, 'demo_submit', client_ip(req), 30, 60, now);
  if (!limited.allowed) throw new ApiError(429, 'rate_limited', 'too many requests');
  const body = await read_json(req, demo_submit_schema);
  require_fresh(body.issued_at, now);
  const msg = demo_submit_message(body.wallet, body.challenge_id, body.instance_id, body.issued_at);
  require_signature(await signature_matches(body.wallet, msg, body.signature));

  // Validate against the challenge before storing. Only DEMO challenges accept demo submissions.
  const ch = await rt.port.get_challenge(body.challenge_id);
  if (ch.status === STATUS.None) throw new ApiError(400, 'unknown_challenge', 'challenge does not exist');
  const meta = await load_metadata_by_hash(rt, ch.metadata_hash);
  if (meta === null || meta.lms !== 'demo') throw new ApiError(400, 'not_demo_challenge', 'challenge is not a demo challenge');
  if (!has_demo_activity(meta.activities, body.instance_id)) {
    throw new ApiError(400, 'unknown_activity', 'instance_id is not an activity of this challenge');
  }

  await record_demo_submission(rt.store.kv, body.wallet, body.challenge_id, body.instance_id, now);
  // Drop the cached progress for this (challenge, wallet) so the next GET /progress shows the new submission.
  await rt.store.kv.delete(progress_cache_key(body.challenge_id, body.wallet));
  return json_response({ ok: true, label: 'DEMO', submitted_at: now }, 200);
}

async function has_open_challenge_for(rt: Runtime, wallet: string): Promise<boolean> {
  const count = await rt.port.challenge_count();
  for (let id = 1; id <= count; id++) {
    const accounts = await participants_of(rt.store.kv, id);
    if (!accounts.includes(wallet)) continue;
    const ch = await rt.port.get_challenge(id);
    if (ch.status === STATUS.Open) return true;
  }
  return false;
}

interface ProgressActivity {
  instance_id: number;
  kind: string;
  submitted: boolean;
  time_finished: number | null;
  status: 'ok' | 'missing' | 'link_broken' | 'lms_unavailable' | 'unknown';
}

/**
 * Progress for one (challenge, wallet). Rate limited per IP and cached per (challenge, wallet) for 60 s,
 * so repeated polls cannot drive calls to the school Moodle. Tokens are never returned or logged.
 */
async function handle_progress(req: Request, rt: Runtime, id: number, wallet: string, now: number): Promise<Response> {
  const limited = await check_rate_limit(rt.store.kv, 'progress', client_ip(req), PROGRESS_RATE_LIMIT, PROGRESS_RATE_WINDOW_SECONDS, now);
  if (!limited.allowed) throw new ApiError(429, 'rate_limited', 'too many requests');

  const cache_key = progress_cache_key(id, wallet);
  const cached = await rt.store.kv.get(cache_key);
  if (cached !== null) return new Response(cached, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });

  const ch = await rt.port.get_challenge(id);
  if (ch.status === STATUS.None) throw new ApiError(404, 'not_found', 'challenge not found');
  const meta = await load_metadata_by_hash(rt, ch.metadata_hash);
  if (meta === null) throw new ApiError(404, 'not_found', 'metadata not found');
  const link = await get_link(rt.store.kv, wallet);
  const stake = await rt.port.stake_of(id, wallet);
  const activities: ProgressActivity[] = [];
  for (const act of meta.activities) {
    const base = { instance_id: act.instance_id, kind: act.kind };
    if (link === null || stake === 0n) {
      activities.push({ ...base, submitted: false, time_finished: null, status: 'missing' });
      continue;
    }
    try {
      const adapter =
        link.lms === 'demo' ? create_demo_adapter(rt.store.kv) : create_moodle_adapter({ want_grade: meta.min_grade !== null });
      const token = link.token_enc === null ? null : await decrypt_token(link.token_enc, rt.cfg.token_enc_key);
      const info: LinkInfo = { lms: link.lms, site: link.site, userid: link.userid, wallet, token, challenge_id: id };
      const s: ActivityStatus = await adapter.get_activity_status(info, act);
      activities.push({
        ...base,
        submitted: s.submitted,
        time_finished: s.finished_times[0] ?? null,
        status: s.submitted ? 'ok' : 'missing',
      });
    } catch (err) {
      const code = err instanceof LmsError ? err.code : 'other';
      activities.push({ ...base, submitted: false, time_finished: null, status: progress_user_error(code) });
    }
  }
  const body = { challenge_id: id, wallet, stake: stake.toString(), activities, as_of: now };
  await rt.store.kv.put(cache_key, JSON.stringify(body), { expirationTtl: PROGRESS_CACHE_TTL_SECONDS });
  return json_response(body, 200);
}

/** The challenge must exist and have a committed evidence_hash (Settled, Disputed or Finalized). */
async function committed_challenge(rt: Runtime, id: number): Promise<ChallengeRow> {
  const ch = await rt.port.get_challenge(id);
  if (ch.status === STATUS.None) throw new ApiError(404, 'not_found', 'challenge not found');
  if (!is_committed(ch)) throw new ApiError(404, 'not_committed', 'evidence is not committed on chain yet');
  return ch;
}

async function handle_evidence_get(rt: Runtime, id: number): Promise<Response> {
  const ch = await committed_challenge(rt, id);
  const found = await load_committed_evidence(rt.store.r2, rt.cfg.chain_id, ch);
  if (found === null) throw new ApiError(404, 'not_found', 'evidence not found');
  return new Response(found.canonical, { status: 200, headers: { 'content-type': 'application/json' } });
}

/**
 * Permissionless upload for the guardian after resolve_dispute. Stored only when the document hashes to the
 * on-chain evidence_hash and its chain_id, manager, challenge_id and root match the challenge.
 */
async function handle_evidence_put(req: Request, rt: Runtime, id: number): Promise<Response> {
  const body = await read_json(req, z.unknown(), MAX_EVIDENCE_BYTES);
  const ch = await committed_challenge(rt, id);
  const checked = check_evidence_upload(body, ch, rt.cfg);
  if (!checked.ok) throw new ApiError(400, 'evidence_rejected', `evidence rejected: ${checked.reason}`);
  await put_evidence(rt.store.r2, evidence_key(rt.cfg.chain_id, id, ch.evidence_hash), checked.canonical);
  return json_response({ challenge_id: id, evidence_hash: ch.evidence_hash, stored: true }, 201);
}

async function handle_proof(rt: Runtime, id: number, account: string): Promise<Response> {
  const ch = await committed_challenge(rt, id);
  const lookup = await committed_proof(rt.store.r2, rt.cfg.chain_id, ch, account);
  if (lookup.kind === 'no_evidence') throw new ApiError(404, 'not_found', 'evidence not found');
  if (lookup.kind === 'no_account') throw new ApiError(404, 'not_found', 'account not in evidence');
  return json_response(lookup.proof, 200);
}

async function handle_faucet(req: Request, rt: Runtime, now: number): Promise<Response> {
  const cfg = rt.cfg;
  const auth = await verify_privy_jwt(req.headers.get('authorization'), cfg.privy_app_id);
  const body = await read_json(req, faucet_schema);
  const faucet_key = cfg.faucet_private_key;
  if (faucet_key === null) throw new ApiError(503, 'faucet_disabled', 'faucet not configured');
  const ip = client_ip(req);
  const limited = await check_rate_limit(rt.store.kv, 'faucet', ip, 5, 3600, now);
  if (!limited.allowed) throw new ApiError(429, 'rate_limited', 'too many requests');
  if (!(await verify_turnstile(cfg.turnstile_secret, body.turnstile_token, ip))) {
    throw new ApiError(403, 'turnstile_failed', 'human check failed');
  }
  const balance = await rt.public_client.getBalance({ address: body.wallet as `0x${string}` });
  const account = privateKeyToAccount(faucet_key);
  const wallet_client = createWalletClient({ account, chain: chain_for(cfg), transport: http(cfg.rpc_url) });
  // Eligibility, reserve (pending keys written before the send), send, then finalize with the tx hash.
  const tx_hash = await run_faucet_grant({
    kv: rt.store.kv,
    privy_sub: auth.sub,
    wallet: body.wallet,
    balance_wei: balance,
    daily_cap: cfg.faucet_daily_cap,
    now_seconds: now,
    send: (to) => wallet_client.sendTransaction({ to: to as `0x${string}`, value: cfg.faucet_amount_wei }),
  });
  return json_response({ tx_hash, amount_wei: cfg.faucet_amount_wei.toString() }, 200);
}
