import { describe, expect, it } from 'vitest';
import { keccak256, toBytes } from 'viem';
import { build_evidence, check_participant_completeness, clear_finished_tokens, run_settle_job, type SettleDeps } from '../src/settle.ts';
import { check_evidence_upload, hash_canonical, load_committed_evidence, committed_proof } from '../src/evidence.ts';
import { evidence_key, type Evidence } from '../src/merkle.ts';
import { canonical_json } from '../src/canonical.ts';
import { STATUS, type ChainPort, type ChallengeRow } from '../src/chain.ts';
import { reserve_faucet_grant, run_faucet_grant, faucet_user_key, faucet_wallet_key, FAUCET_PENDING } from '../src/faucet.ts';
import { ApiError } from '../src/http.ts';
import { make_memory_kv } from './support/kv.ts';
import { metadata_hash, metadata_key, type ChallengeMetadata } from '../src/metadata.ts';
import { LmsError } from '../src/lms/types.ts';

const MANAGER = '0x' + 'ab'.repeat(20);
const ROOT = ('0x' + '0'.repeat(64)) as `0x${string}`;
const A = '0x' + '11'.repeat(20);
const B = '0x' + '22'.repeat(20);
const C = '0x' + '33'.repeat(20);

function make_challenge(over: Partial<ChallengeRow> = {}): ChallengeRow {
  return {
    id: 1,
    token: '0x' + '01'.repeat(20),
    vault: '0x' + '02'.repeat(20),
    creator: '0x' + '03'.repeat(20),
    min_stake: 1n,
    max_stake: 10n,
    join_deadline: 0,
    end_time: 100,
    settle_grace: 10,
    dispute_window: 10,
    metadata_hash: ('0x' + 'aa'.repeat(32)) as `0x${string}`,
    status: STATUS.Open,
    total_principal: 0n,
    total_bonus: 0n,
    participant_count: 2,
    root: ROOT,
    evidence_hash: ('0x' + '00'.repeat(32)) as `0x${string}`,
    settled_at: 0,
    disputed_at: 0,
    completed_count: 0,
    completed_stake: 0n,
    finalized_at: 0,
    final_assets: 0n,
    reward_pot: 0n,
    reward_paid: 0n,
    loss: false,
    rewards_swept: false,
    treasury_due: 0n,
    treasury_collected: false,
    ...over,
  };
}

/** Port stub: stake_of comes from a map, everything else is unused by the completeness check. */
function stub_port(stakes: Record<string, bigint>): ChainPort {
  const unused = () => {
    throw new Error('unused in this test');
  };
  return {
    block_number: unused,
    challenge_count: unused,
    get_challenge: unused,
    scan_joins: unused,
    joined_at: unused,
    stake_of: async (_id: number, account: string) => stakes[account.toLowerCase()] ?? 0n,
    settle: unused,
    finalize: unused,
    expire: unused,
    collect_treasury: unused,
    has_creator_role: unused,
    creator_role: unused,
    oracle_address: () => '0x' + '00'.repeat(20),
  } as unknown as ChainPort;
}

function make_deps(kv: ReturnType<typeof make_memory_kv>, port: ChainPort, logs: string[]): SettleDeps {
  return {
    port,
    store: { kv, r2: { put: async () => {}, get: async () => null } },
    chain_id: 31337,
    manager: MANAGER,
    deploy_block: 7n,
    token_enc_key: 'k',
    decrypt_token: async () => '',
    demo_adapter: {} as SettleDeps['demo_adapter'],
    moodle_adapter: () => ({}) as SettleDeps['demo_adapter'],
    now: () => 1000,
    log: (event) => logs.push(event),
  };
}

describe('F2 participant completeness', () => {
  it('passes when KV staked count equals on-chain participant_count', async () => {
    const kv = make_memory_kv();
    await kv.put('participants:1', JSON.stringify([A, B]));
    const logs: string[] = [];
    const deps = make_deps(kv, stub_port({ [A]: 5n, [B]: 6n }), logs);
    expect(await check_participant_completeness(deps, make_challenge({ participant_count: 2 }))).toBe(true);
    expect(logs).toEqual([]);
  });

  it('ignores accounts with zero stake when counting', async () => {
    const kv = make_memory_kv();
    await kv.put('participants:1', JSON.stringify([A, B, C]));
    const deps = make_deps(kv, stub_port({ [A]: 5n, [B]: 6n, [C]: 0n }), []);
    expect(await check_participant_completeness(deps, make_challenge({ participant_count: 2 }))).toBe(true);
  });

  it('on mismatch: logs, resets the scan cursor to deploy_block, and returns false', async () => {
    const kv = make_memory_kv();
    await kv.put('participants:1', JSON.stringify([A]));
    await kv.put('scan_cursor:31337:' + MANAGER.toLowerCase(), '9999');
    const logs: string[] = [];
    const deps = make_deps(kv, stub_port({ [A]: 5n }), logs);
    expect(await check_participant_completeness(deps, make_challenge({ participant_count: 2 }))).toBe(false);
    expect(logs).toEqual(['participant_count_mismatch']);
    expect(await kv.get('scan_cursor:31337:' + MANAGER.toLowerCase())).toBe('7');
  });

  it('a KV count above the chain count also defers (not only missing joins)', async () => {
    const kv = make_memory_kv();
    await kv.put('participants:1', JSON.stringify([A, B]));
    const deps = make_deps(kv, stub_port({ [A]: 1n, [B]: 1n }), []);
    expect(await check_participant_completeness(deps, make_challenge({ participant_count: 1 }))).toBe(false);
  });
});

describe('Moodle settlement and evidence', () => {
  it('defers a temporary Moodle error through the last second and expires at the grace deadline', async () => {
    const kv = make_memory_kv();
    const site = 'https://moodle.example.edu';
    const meta: ChallengeMetadata = {
      version: 1, title: 'Course', lms: 'moodle', site, course_id: 2,
      activities: [{ kind: 'quiz', instance_id: 1, name: 'Quiz', due: 90 }], min_grade: null,
    };
    const hash = metadata_hash(meta);
    const ch = make_challenge({ metadata_hash: hash, participant_count: 1 });
    await kv.put('participants:1', JSON.stringify([A]));
    await kv.put(`link:${A}`, JSON.stringify({ wallet: A, lms: 'moodle', site, userid: 1, token_enc: 'encrypted' }));
    const deps = make_deps(kv, stub_port({ [A]: 5n }), []);
    deps.port.block_number = async () => 6n;
    deps.port.challenge_count = async () => 1;
    deps.port.get_challenge = async () => ch;
    deps.port.joined_at = async () => 50;
    deps.port.expire = async () => '0xexpired';
    deps.store.r2.get = async key => key === metadata_key(hash) ? { text: async () => canonical_json(meta) } : null;
    deps.store.r2.put = async () => { throw new Error('unexpected evidence write'); };
    deps.moodle_adapter = () => ({ get_activity_status: async () => { throw new LmsError('timed out', 'timeout'); } });
    deps.now = () => ch.end_time + ch.settle_grace - 1;
    expect((await run_settle_job(deps)).challenges).toEqual([{ id: 1, action: 'deferred', detail: 'lms_error' }]);
    deps.now = () => ch.end_time + ch.settle_grace;
    expect((await run_settle_job(deps)).challenges).toEqual([{ id: 1, action: 'expired', tx_hash: '0xexpired' }]);
  });

  it('publishes redacted Moodle evidence with the same Merkle root and proofs as v1', async () => {
    const cfg = { chain_id: 31337, manager: MANAGER };
    const ch = make_challenge({ status: STATUS.Settled });
    const results: Parameters<typeof build_evidence>[4] = [{
      account: A, subject_hash: 'student-subject', joined_at: 50,
      result: {
        account: A, stake: 5n, completed: true, reason: 'ok',
        activities: [{ instance_id: 1, submitted: true, time_finished: 80, grade: 9, reason: 'ok' }],
      },
    }];
    const legacy = build_evidence(cfg, ch, ch.metadata_hash, 100, results, 'demo');
    const redacted = build_evidence(cfg, ch, ch.metadata_hash, 100, results, 'moodle');
    expect(redacted.evidence.version).toBe(2);
    expect(redacted.evidence.entries).toEqual([{ account: A, stake: '5', completed: true, reason: 'ok' }]);
    expect(redacted.root).toBe(legacy.root);
    const lookup = async (built: typeof redacted) => committed_proof({
      put: async () => {}, get: async () => ({ text: async () => built.canonical }),
    }, cfg.chain_id, { ...ch, evidence_hash: built.evidence_hash }, A);
    expect(await lookup(redacted)).toEqual(await lookup(legacy));
    expect(await lookup(redacted)).toEqual({ kind: 'ok', proof: { completed: true, stake: '5', proof: [] } });
  });
});

describe('Moodle token cleanup', () => {
  const site = 'https://courses.ctda.hcmus.edu.vn';
  const moodle: ChallengeMetadata = {
    version: 1, title: 'Course', lms: 'moodle', site, course_id: 2,
    activities: [{ kind: 'quiz', instance_id: 1, name: 'Quiz', due: 80 }], min_grade: null,
  };

  async function clean(meta: ChallengeMetadata, linked_at: number, second?: ChallengeRow) {
    const kv = make_memory_kv();
    await kv.put('participants:1', JSON.stringify([A]));
    if (second) await kv.put('participants:2', JSON.stringify([A]));
    await kv.put(`link:${A}`, JSON.stringify({ wallet: A, lms: 'moodle', site, token_enc: 'encrypted', linked_at }));
    const hash = metadata_hash(meta);
    const deps = make_deps(kv, stub_port({}), []);
    deps.port.get_challenge = async id => id === 2 && second ? second :
      make_challenge({ status: STATUS.Finalized, finalized_at: 100, metadata_hash: hash });
    deps.store.r2.get = async key => key === metadata_key(hash) ? { text: async () => canonical_json(meta) } : null;
    await clear_finished_tokens(deps, second ? 2 : 1);
    return JSON.parse((await kv.get(`link:${A}`))!).token_enc;
  }

  it('keeps a Moodle token after a Demo LMS round', async () => {
    expect(await clean({ ...moodle, lms: 'demo', site: 'demo' }, 50)).toBe('encrypted');
  });

  it('keeps a refreshed token after an older Moodle round', async () => {
    expect(await clean(moodle, 110)).toBe('encrypted');
  });

  it('clears a token used in a finished Moodle round unless the wallet has an unsettled round', async () => {
    expect(await clean(moodle, 50)).toBeNull();
    expect(await clean(moodle, 50, make_challenge({ status: STATUS.Disputed }))).toBe('encrypted');
  });
});

describe('F3 content-addressed evidence', () => {
  const doc = (over: Partial<Evidence> = {}): Evidence => ({
    version: 1,
    chain_id: 31337,
    manager: MANAGER,
    challenge_id: 1,
    metadata_hash: '0x' + 'aa'.repeat(32),
    generated_at: 5,
    root: ROOT,
    completed_count: 0,
    completed_stake: '0',
    entries: [{ account: A, stake: '1', completed: false, reason: 'missing', subject_hash: null, activities: [] }],
    tree: null,
    ...over,
  });

  it('evidence_key includes the evidence hash, so two documents never share a key', () => {
    const h1 = hash_canonical(doc({ generated_at: 1 }))!.hash;
    const h2 = hash_canonical(doc({ generated_at: 2 }))!.hash;
    expect(evidence_key(31337, 1, h1)).not.toBe(evidence_key(31337, 1, h2));
    expect(evidence_key(31337, 1, h1)).toBe(`evidence/31337/1/${h1}.json`);
  });

  it('load_committed_evidence returns the object whose hash matches the on-chain evidence_hash', async () => {
    const d = doc();
    const h = hash_canonical(d)!.hash;
    const store = new Map<string, string>([[evidence_key(31337, 1, h), hash_canonical(d)!.canonical]]);
    const r2 = { put: async () => {}, get: async (k: string) => (store.has(k) ? { text: async () => store.get(k)! } : null) };
    const ch = make_challenge({ status: STATUS.Settled, evidence_hash: h });
    const found = await load_committed_evidence(r2, 31337, ch);
    expect(found?.evidence.generated_at).toBe(5);
  });

  it('load_committed_evidence throws 500 when the stored bytes do not hash to the on-chain hash', async () => {
    const d = doc();
    const h = hash_canonical(d)!.hash;
    const tampered = canonical_json(doc({ generated_at: 999 }));
    const store = new Map<string, string>([[evidence_key(31337, 1, h), tampered]]);
    const r2 = { put: async () => {}, get: async (k: string) => (store.has(k) ? { text: async () => store.get(k)! } : null) };
    const ch = make_challenge({ status: STATUS.Settled, evidence_hash: h });
    const err = await load_committed_evidence(r2, 31337, ch).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(500);
  });

  it('returns null when nothing is stored under the committed hash', async () => {
    const r2 = { put: async () => {}, get: async () => null };
    const ch = make_challenge({ status: STATUS.Settled, evidence_hash: ('0x' + '77'.repeat(32)) as `0x${string}` });
    expect(await load_committed_evidence(r2, 31337, ch)).toBeNull();
  });

  it('committed_proof reads through the verified object and reports no_account for unknown addresses', async () => {
    const d = doc();
    const h = hash_canonical(d)!.hash;
    const store = new Map<string, string>([[evidence_key(31337, 1, h), hash_canonical(d)!.canonical]]);
    const r2 = { put: async () => {}, get: async (k: string) => (store.has(k) ? { text: async () => store.get(k)! } : null) };
    const ch = make_challenge({ status: STATUS.Settled, evidence_hash: h });
    expect((await committed_proof(r2, 31337, ch, B)).kind).toBe('no_account');
    const hit = await committed_proof(r2, 31337, ch, A);
    expect(hit.kind).toBe('ok');
  });

  describe('check_evidence_upload (PUT)', () => {
    const cfg = { chain_id: 31337, manager: MANAGER };
    const good = doc();
    const good_hash = hash_canonical(good)!.hash;
    const ch = make_challenge({ status: STATUS.Disputed, evidence_hash: good_hash, root: ROOT });

    it('accepts a document whose canonical hash equals the on-chain evidence_hash and whose fields match', () => {
      const r = check_evidence_upload(good, ch, cfg);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.canonical).toBe(canonical_json(good));
    });

    it('rejects a document whose hash differs from the on-chain evidence_hash', () => {
      expect(check_evidence_upload(doc({ generated_at: 6 }), ch, cfg)).toEqual({ ok: false, reason: 'evidence_hash_mismatch' });
    });

    it('rejects a matching-hash document from another chain or manager', () => {
      const other_chain = doc({ chain_id: 1 });
      const other_chain_ch = make_challenge({ status: STATUS.Disputed, evidence_hash: hash_canonical(other_chain)!.hash, root: ROOT });
      expect(check_evidence_upload(other_chain, other_chain_ch, cfg)).toEqual({ ok: false, reason: 'chain_id_mismatch' });
      const other_manager = doc({ manager: '0x' + 'cd'.repeat(20) });
      const other_manager_ch = make_challenge({ status: STATUS.Disputed, evidence_hash: hash_canonical(other_manager)!.hash, root: ROOT });
      expect(check_evidence_upload(other_manager, other_manager_ch, cfg)).toEqual({ ok: false, reason: 'manager_mismatch' });
    });

    it('rejects a document with a different challenge_id or root than the challenge', () => {
      const wrong_id = doc({ challenge_id: 2 });
      const wrong_id_ch = make_challenge({ id: 1, status: STATUS.Disputed, evidence_hash: hash_canonical(wrong_id)!.hash, root: ROOT });
      expect(check_evidence_upload(wrong_id, wrong_id_ch, cfg)).toEqual({ ok: false, reason: 'challenge_id_mismatch' });
      const wrong_root = doc({ root: ('0x' + '12'.repeat(32)) as `0x${string}` });
      const wrong_root_ch = make_challenge({ status: STATUS.Disputed, evidence_hash: hash_canonical(wrong_root)!.hash, root: ROOT });
      expect(check_evidence_upload(wrong_root, wrong_root_ch, cfg)).toEqual({ ok: false, reason: 'root_mismatch' });
    });

    it('rejects a non-object body', () => {
      expect(check_evidence_upload([1, 2], ch, cfg)).toEqual({ ok: false, reason: 'not_an_object' });
      expect(check_evidence_upload('x', ch, cfg)).toEqual({ ok: false, reason: 'not_an_object' });
    });

    it('evidence_hash is keccak of the canonical bytes', () => {
      expect(good_hash).toBe(keccak256(toBytes(canonical_json(good))));
    });
  });
});

describe('F5 faucet reservation', () => {
  const base = { privy_sub: 'user-1', wallet: '0x' + 'ab'.repeat(20), balance_wei: 0n, daily_cap: 10, now_seconds: 1_700_000_000 };

  it('reserve writes pending keys and the daily counter before any send', async () => {
    const kv = make_memory_kv();
    await reserve_faucet_grant({ kv, privy_sub: base.privy_sub, wallet: base.wallet, now_seconds: base.now_seconds });
    expect(await kv.get(faucet_user_key(base.privy_sub))).toBe(FAUCET_PENDING);
    expect(await kv.get(faucet_wallet_key(base.wallet))).toBe(FAUCET_PENDING);
  });

  it('a second concurrent request is refused while the first send is in flight', async () => {
    const kv = make_memory_kv();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = run_faucet_grant({ kv, ...base, send: async () => (await gate, '0xtx1') });
    // Let the first request reach the send before the second one starts.
    await new Promise((r) => setTimeout(r, 0));
    const second = run_faucet_grant({ kv, ...base, send: async () => '0xtx2' }).catch((e: unknown) => e);
    const second_err = await second;
    expect(second_err).toBeInstanceOf(ApiError);
    expect((second_err as ApiError).code).toBe('user_already_claimed');
    release();
    expect(await first).toBe('0xtx1');
  });

  it('on success the pending values are overwritten with the tx hash', async () => {
    const kv = make_memory_kv();
    const tx = await run_faucet_grant({ kv, ...base, send: async () => '0xabc' });
    expect(tx).toBe('0xabc');
    expect(JSON.parse((await kv.get(faucet_user_key(base.privy_sub)))!)).toMatchObject({ tx_hash: '0xabc' });
    expect(JSON.parse((await kv.get(faucet_wallet_key(base.wallet)))!)).toMatchObject({ tx_hash: '0xabc' });
  });

  it('on send failure the reservation is released and the user can retry', async () => {
    const kv = make_memory_kv();
    await expect(run_faucet_grant({ kv, ...base, send: async () => { throw new Error('rpc down'); } })).rejects.toThrow('rpc down');
    expect(await kv.get(faucet_user_key(base.privy_sub))).toBeNull();
    expect(await kv.get(faucet_wallet_key(base.wallet))).toBeNull();
    expect(await run_faucet_grant({ kv, ...base, send: async () => '0xretry' })).toBe('0xretry');
  });

  it('the daily counter is returned on send failure', async () => {
    const kv = make_memory_kv();
    await expect(run_faucet_grant({ kv, ...base, send: async () => { throw new Error('x'); } })).rejects.toThrow();
    const day = [...kv._dump().entries()].find(([k]) => k.startsWith('faucet:daily:'));
    expect(day?.[1] ?? '0').toBe('0');
  });
});
