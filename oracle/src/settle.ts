// Cron settle job. Idempotent, with a KV lock. See docs/ORACLE.md "Settle job".
import { evaluate_participant, type ActivityOutcome, type ParticipantResult } from './evaluate.ts';
import { metadata_key, parse_metadata, verify_metadata, type ChallengeMetadata } from './metadata.ts';
import { build_tree, evidence_hash_of, evidence_key, root_of, type Evidence, type EvidenceEntry, type LeafInput } from './merkle.ts';
import { is_link_failure, LmsError, type LinkInfo, type LmsAdapter } from './lms/types.ts';
import { link_matches_challenge } from './link.ts';
import { canonical_json } from './canonical.ts';
import { get_json, get_link, get_text, put_evidence, put_json, try_lock, unlock, type LinkRecord, type Store } from './store.ts';
import type { ChainPort, ChallengeRow } from './chain.ts';
import { STATUS, SCAN_CHUNK_BLOCKS } from './chain.ts';
import { normalize_site } from './config.ts';

export const DISPUTE_TIMEOUT_SECONDS = 7 * 24 * 3600;

export interface SettleDeps {
  port: ChainPort;
  store: Store;
  chain_id: number;
  manager: string;
  deploy_block: bigint;
  token_enc_key: string;
  decrypt_token(packed: string, key_b64: string): Promise<string>;
  demo_adapter: LmsAdapter;
  moodle_adapter(want_grade: boolean): LmsAdapter;
  now(): number;
  log(event: string, data: Record<string, unknown>): void;
}

export interface ChallengeReport {
  id: number;
  action: 'settled' | 'already_settled' | 'deferred' | 'skipped' | 'finalized' | 'expired' | 'collected' | 'none';
  detail?: string;
  tx_hash?: string | null;
}

export interface SettleReport {
  locked: boolean;
  challenges: ChallengeReport[];
}

/** Scans Joined logs from the stored cursor in 2000-block chunks, and records participants per challenge in KV. */
export async function sync_participants(deps: SettleDeps): Promise<void> {
  const { port, store } = deps;
  const cursor_key = scan_cursor_key(deps);
  const stored = await store.kv.get(cursor_key);
  let from = stored === null ? deps.deploy_block : BigInt(stored);
  const head = await port.block_number();
  while (from <= head) {
    const to = from + SCAN_CHUNK_BLOCKS - 1n < head ? from + SCAN_CHUNK_BLOCKS - 1n : head;
    const joins = await port.scan_joins(from, to);
    for (const j of joins) {
      const key = `participants:${j.id}`;
      const list = (await get_json<string[]>(store.kv, key)) ?? [];
      if (!list.includes(j.account)) {
        list.push(j.account);
        await put_json(store.kv, key, list);
      }
    }
    from = to + 1n;
    await store.kv.put(cursor_key, from.toString());
  }
}

export async function participants_of(kv: Store['kv'], id: number): Promise<string[]> {
  return (await get_json<string[]>(kv, `participants:${id}`)) ?? [];
}

/** Loads and verifies metadata against the on-chain hash. Returns null (and logs) when missing or mismatched. */
async function load_metadata(deps: SettleDeps, ch: ChallengeRow): Promise<ChallengeMetadata | null> {
  const text = await get_text(deps.store.r2, metadata_key(ch.metadata_hash));
  if (text === null) {
    deps.log('metadata_missing', { id: ch.id });
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    deps.log('metadata_bad_json', { id: ch.id });
    return null;
  }
  if (!verify_metadata(raw, ch.metadata_hash)) {
    deps.log('metadata_hash_mismatch', { id: ch.id });
    return null;
  }
  try {
    return parse_metadata(raw);
  } catch {
    deps.log('metadata_invalid_schema', { id: ch.id });
    return null;
  }
}

/** Fetches the status of every activity for one account. Maps LMS errors to outcomes, never throws. */
async function activity_outcomes(
  deps: SettleDeps,
  meta: ChallengeMetadata,
  link: LinkRecord,
  info: LinkInfo,
): Promise<{ outcomes: ActivityOutcome[]; had_lms_error: boolean }> {
  const adapter = link.lms === 'demo' ? deps.demo_adapter : deps.moodle_adapter(meta.min_grade !== null);
  const outcomes: ActivityOutcome[] = [];
  let had_lms_error = false;
  for (const act of meta.activities) {
    try {
      const status = await adapter.get_activity_status(info, act);
      outcomes.push({ instance_id: act.instance_id, due: act.due, ok: true, status });
    } catch (err) {
      if (err instanceof LmsError && is_link_failure(err.code)) {
        outcomes.push({ instance_id: act.instance_id, due: act.due, ok: false, code: 'link_broken' });
      } else {
        had_lms_error = true;
        outcomes.push({ instance_id: act.instance_id, due: act.due, ok: false, code: 'lms_error' });
      }
    }
  }
  return { outcomes, had_lms_error };
}

interface Evaluated {
  results: { account: string; result: ParticipantResult; subject_hash: string | null; joined_at: number }[];
  lms_error_accounts: string[];
}

async function evaluate_challenge(deps: SettleDeps, ch: ChallengeRow, meta: ChallengeMetadata): Promise<Evaluated> {
  const accounts = await participants_of(deps.store.kv, ch.id);
  const results: Evaluated['results'] = [];
  const lms_error_accounts: string[] = [];
  for (const account of accounts) {
    const stake = await deps.port.stake_of(ch.id, account);
    if (stake === 0n) continue;
    const joined_at = await deps.port.joined_at(ch.id, account);
    const link = await get_link(deps.store.kv, account);
    const linked = link !== null && link_matches_challenge(link, meta);
    let outcomes: ActivityOutcome[] = [];
    let had_lms_error = false;
    if (linked) {
      let token: string | null = null;
      if (link.lms === 'moodle') {
        if (link.token_enc === null) {
          outcomes = meta.activities.map((a) => ({ instance_id: a.instance_id, due: a.due, ok: false as const, code: 'link_broken' as const }));
        } else {
          try {
            token = await deps.decrypt_token(link.token_enc, deps.token_enc_key);
          } catch {
            had_lms_error = true;
            outcomes = meta.activities.map((a) => ({ instance_id: a.instance_id, due: a.due, ok: false, code: 'lms_error' }));
          }
        }
      }
      if (link.lms === 'demo' || token !== null) {
        const info: LinkInfo = {
          lms: link.lms,
          site: link.site,
          userid: link.userid,
          wallet: account,
          token,
          challenge_id: ch.id,
        };
        const got = await activity_outcomes(deps, meta, link, info);
        outcomes = got.outcomes;
        had_lms_error = got.had_lms_error;
      }
    }
    if (had_lms_error) lms_error_accounts.push(account);
    const result = evaluate_participant({
      account,
      stake,
      joined_at,
      end_time: ch.end_time,
      min_grade: meta.min_grade,
      linked,
      activities: outcomes,
    });
    const subject_hash = linked && link !== null ? link.subject_hash : null;
    results.push({ account, result, subject_hash, joined_at });
  }
  return { results, lms_error_accounts };
}

/** Builds the evidence document and tree for a challenge. Pure apart from the call to canonical/hash helpers. */
export function build_evidence(
  deps: { chain_id: number; manager: string },
  ch: ChallengeRow,
  metadata_hash: string,
  generated_at: number,
  results: Evaluated['results'],
  lms: ChallengeMetadata['lms'] = 'demo',
): { evidence: Evidence; root: `0x${string}`; completed_count: number; completed_stake: bigint; evidence_hash: `0x${string}`; canonical: string } {
  const completers: LeafInput[] = results
    .filter((r) => r.result.completed)
    .map((r) => ({ chain_id: deps.chain_id, manager: deps.manager, challenge_id: ch.id, account: r.account, stake: r.result.stake }));
  const tree = build_tree(completers);
  const completed_stake = completers.reduce((s, l) => s + l.stake, 0n);
  const entries: EvidenceEntry[] = results.map((r) => ({
    account: r.account,
    stake: r.result.stake.toString(),
    completed: r.result.completed,
    reason: r.result.reason,
    ...(lms === 'demo' ? {
      subject_hash: r.subject_hash,
      activities: r.result.activities.map((a) => ({
        instance_id: a.instance_id,
        submitted: a.submitted,
        time_finished: a.time_finished,
      })),
    } : {}),
  }));
  const evidence: Evidence = {
    version: lms === 'moodle' ? 2 : 1,
    chain_id: deps.chain_id,
    manager: deps.manager,
    challenge_id: ch.id,
    metadata_hash: metadata_hash,
    generated_at,
    root: root_of(tree),
    completed_count: completers.length,
    completed_stake: completed_stake.toString(),
    entries,
    tree: tree === null ? null : tree.dump(),
  };
  return {
    evidence,
    root: root_of(tree) as `0x${string}`,
    completed_count: completers.length,
    completed_stake,
    evidence_hash: evidence_hash_of(evidence),
    canonical: canonical_json(evidence),
  };
}

/**
 * Guards against a missed Joined log. Counts KV participants with stake > 0 and compares to the on-chain
 * participant_count. On mismatch, resets the scan cursor to deploy_block (forces a full rescan next run)
 * and returns false so the caller defers settlement.
 */
export async function check_participant_completeness(deps: SettleDeps, ch: ChallengeRow): Promise<boolean> {
  const accounts = await participants_of(deps.store.kv, ch.id);
  let staked = 0;
  for (const account of accounts) {
    if ((await deps.port.stake_of(ch.id, account)) > 0n) staked++;
  }
  if (staked === ch.participant_count) return true;
  deps.log('participant_count_mismatch', { id: ch.id, kv_staked: staked, chain_count: ch.participant_count });
  await deps.store.kv.put(scan_cursor_key(deps), deps.deploy_block.toString());
  return false;
}

function scan_cursor_key(deps: Pick<SettleDeps, 'chain_id' | 'manager'>): string {
  return `scan_cursor:${deps.chain_id}:${deps.manager.toLowerCase()}`;
}

async function settle_one(deps: SettleDeps, ch: ChallengeRow): Promise<ChallengeReport> {
  const meta = await load_metadata(deps, ch);
  if (meta === null) return { id: ch.id, action: 'skipped', detail: 'metadata' };

  if (!(await check_participant_completeness(deps, ch))) {
    return { id: ch.id, action: 'deferred', detail: 'participant_count' };
  }

  const evaluated = await evaluate_challenge(deps, ch, meta);
  if (deps.now() >= ch.end_time + ch.settle_grace) {
    return (await advance_one(deps, ch))[0]!;
  }
  if (evaluated.lms_error_accounts.length > 0) {
    deps.log('settle_deferred_lms_error', { id: ch.id, accounts: evaluated.lms_error_accounts.length });
    return { id: ch.id, action: 'deferred', detail: 'lms_error' };
  }

  const built = build_evidence(deps, ch, ch.metadata_hash, deps.now(), evaluated.results, meta.lms);
  // Content-addressed: a later run with different results writes a different key and never replaces this one.
  await put_evidence(deps.store.r2, evidence_key(deps.chain_id, ch.id, built.evidence_hash), built.canonical);

  const sent = await deps.port.settle({
    id: ch.id,
    root: built.root,
    completed_count: built.completed_count,
    completed_stake: built.completed_stake,
    evidence_hash: built.evidence_hash,
  });
  if (sent.outcome === 'settled') {
    await put_json(deps.store.kv, `settled:${ch.id}`, { root: built.root, evidence_hash: built.evidence_hash, tx_hash: sent.tx_hash });
    return { id: ch.id, action: 'settled', tx_hash: sent.tx_hash };
  }
  await put_json(deps.store.kv, `settled:${ch.id}`, { root: built.root, evidence_hash: built.evidence_hash, tx_hash: null });
  return { id: ch.id, action: 'already_settled' };
}

/** Finalize (or expire, for Open after grace) and collect_treasury when due. */
async function advance_one(deps: SettleDeps, ch: ChallengeRow): Promise<ChallengeReport[]> {
  const out: ChallengeReport[] = [];
  const t = deps.now();
  const st = ch.status;
  if (st === STATUS.Settled && t >= ch.settled_at + ch.dispute_window) {
    const tx = await deps.port.finalize(ch.id);
    out.push({ id: ch.id, action: 'finalized', tx_hash: tx });
  } else if (st === STATUS.Disputed && t >= ch.disputed_at + DISPUTE_TIMEOUT_SECONDS) {
    const tx = await deps.port.finalize(ch.id);
    out.push({ id: ch.id, action: 'finalized', detail: 'dispute_timeout', tx_hash: tx });
  } else if (st === STATUS.Open && t >= ch.end_time + ch.settle_grace) {
    const tx = await deps.port.expire(ch.id);
    out.push({ id: ch.id, action: 'expired', tx_hash: tx });
  }
  return out;
}

export async function run_settle_job(deps: SettleDeps): Promise<SettleReport> {
  const got_lock = await try_lock(deps.store.kv, 'settle');
  if (!got_lock) return { locked: false, challenges: [] };
  const reports: ChallengeReport[] = [];
  try {
    await sync_participants(deps);
    const count = await deps.port.challenge_count();
    const t = deps.now();
    for (let id = 1; id <= count; id++) {
      const ch = await deps.port.get_challenge(id);
      try {
        if (ch.status === STATUS.Open && ch.end_time <= t && t < ch.end_time + ch.settle_grace) {
          reports.push(await settle_one(deps, ch));
        } else {
          const advanced = await advance_one(deps, ch);
          if (advanced.length === 0) reports.push({ id, action: 'none' });
          reports.push(...advanced);
        }
        const fresh = await deps.port.get_challenge(id);
        if (fresh.treasury_due > 0n && !fresh.treasury_collected) {
          const tx = await deps.port.collect_treasury(id);
          reports.push({ id, action: 'collected', tx_hash: tx });
        }
      } catch (err) {
        deps.log('challenge_error', { id, message: err instanceof Error ? err.message : String(err) });
        reports.push({ id, action: 'skipped', detail: 'error' });
      }
    }
    await clear_finished_tokens(deps, count);
    return { locked: true, challenges: reports };
  } finally {
    await unlock(deps.store.kv, 'settle');
  }
}

/** Clear tokens used by finished Moodle rounds, once the wallet has no unsettled challenge. */
export async function clear_finished_tokens(deps: SettleDeps, count: number): Promise<void> {
  const open_accounts = new Set<string>();
  const finished_accounts = new Map<string, Map<string, number>>();
  for (let id = 1; id <= count; id++) {
    const accounts = await participants_of(deps.store.kv, id);
    if (accounts.length === 0) continue;
    const ch = await deps.port.get_challenge(id);
    if (ch.status === STATUS.Open || ch.status === STATUS.Settled || ch.status === STATUS.Disputed) {
      for (const a of accounts) open_accounts.add(a);
      continue;
    }
    if (!ch.finalized_at || (ch.status !== STATUS.Finalized && ch.status !== STATUS.Expired)) continue;
    const meta = await load_metadata(deps, ch);
    if (meta?.lms !== 'moodle') continue;
    const site = normalize_site(meta.site);
    for (const account of accounts) {
      const sites = finished_accounts.get(account) ?? new Map<string, number>();
      sites.set(site, Math.max(sites.get(site) ?? 0, ch.finalized_at));
      finished_accounts.set(account, sites);
    }
  }
  for (const [account, sites] of finished_accounts) {
    if (open_accounts.has(account)) continue;
    const link = await get_link(deps.store.kv, account);
    if (link?.lms === 'moodle' && link.token_enc !== null &&
        (sites.get(normalize_site(link.site)) ?? 0) > (link.linked_at ?? 0)) {
      await put_json(deps.store.kv, `link:${account}`, { ...link, token_enc: null });
    }
  }
}

