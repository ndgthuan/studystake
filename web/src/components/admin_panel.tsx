'use client';
// Minimal admin: create challenge (metadata signed and posted to the oracle first), sponsor, pause/unpause,
// resolve dispute. The treasury can sponsor from x402 revenue without a creator role.
import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccount, useWalletClient } from 'wagmi';
import { isAddress, isAddressEqual, keccak256, toBytes, type Hex } from 'viem';
import { use_ui } from '@/hooks/use_ui';
import { use_tx } from '@/hooks/use_tx';
import { use_roles } from '@/hooks/use_roles';
import { invalidate_challenge_queries } from '@/hooks/use_challenge';
import { addresses, abis, public_client, to_challenge } from '@/lib/contracts';
import { CHAIN_ID, DEFAULT_MOODLE_SITE } from '@/lib/config';
import { stake_tokens } from '@/lib/tokens';
import { canonical_json } from '@/lib/canonical';
import { metadata_message } from '@/lib/messages';
import { oracle, type MetadataDoc } from '@/lib/oracle';
import { format_usdc, parse_usdc } from '@/lib/usdc';
import { explain_error } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { TxStatusLine } from './tx_status';

export function AdminPanel() {
  const { lang } = use_ui();
  const { address } = useAccount();
  const { creator, guardian, can_access_admin, is_treasury, treasury_address, loading } = use_roles();

  if (!address) return <p className="text-[var(--muted)]">{t(lang, 'connect')}</p>;
  if (loading) return <p className="text-[var(--muted)]">{t(lang, 'loading')}</p>;
  if (!can_access_admin) return <p className="text-[var(--muted)]">{t(lang, 'admin_no_role')}</p>;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{t(lang, 'admin_title')}</h1>
      {creator ? <CreateChallenge /> : null}
      {creator || is_treasury ? <SponsorForm can_sponsor_manually={creator} treasury={treasury_address} is_treasury={is_treasury} /> : null}
      {guardian ? <Guardian /> : null}
    </div>
  );
}

function CreateChallenge() {
  const { lang } = use_ui();
  const { address } = useAccount();
  const { data: client } = useWalletClient();
  const qc = useQueryClient();
  const { state, run } = use_tx(lang, () => invalidate_challenge_queries(qc));
  const [title, set_title] = useState('');
  const [lms, set_lms] = useState<MetadataDoc['lms']>(CHAIN_ID === 43113 ? 'moodle' : 'demo');
  const [site, set_site] = useState(CHAIN_ID === 43113 ? DEFAULT_MOODLE_SITE : 'demo');
  const [course, set_course] = useState('');
  const [quiz, set_quiz] = useState('');
  const [assignment, set_assignment] = useState('');
  const [due_hours, set_due_hours] = useState('1');
  const [join_min, set_join_min] = useState('5');
  const [min_text, set_min] = useState('1');
  const [max_text, set_max] = useState('500');
  const tokens = stake_tokens();
  const [token_key, set_token_key] = useState(tokens[0]!.key);
  const stake_token = tokens.find((x) => x.key === token_key) ?? tokens[0]!;
  const [msg, set_msg] = useState<string | null>(null);
  const [creating, set_creating] = useState(false);
  const min_stake = parse_usdc(min_text);
  const max_stake = parse_usdc(max_text);
  const join_seconds = Math.round(Number(join_min) * 60);
  const due_seconds = Math.round(Number(due_hours) * 3600);
  const course_id = parse_moodle_id(course);
  const quiz_id = parse_moodle_id(quiz);
  const assignment_id = parse_moodle_id(assignment);
  const valid_moodle = course_id !== null && (quiz_id !== null || assignment_id !== null) &&
    (!quiz.trim() || quiz_id !== null) && (!assignment.trim() || assignment_id !== null);
  const clean_site = site.trim().replace(/\/+$/, '');
  const ready = title.trim().length > 0 && clean_site.length > 0 &&
    Number.isSafeInteger(join_seconds) && Number.isSafeInteger(due_seconds) && join_seconds > 0 && due_seconds > join_seconds &&
    min_stake !== null && min_stake > 0n && max_stake !== null && max_stake >= min_stake &&
    (lms === 'demo' || valid_moodle);

  async function create() {
    if (!address || !client || !ready || creating) return;
    set_msg(null);
    set_creating(true);
    try {
      const now = Math.floor(Date.now() / 1000);
      const end_time = now + due_seconds;
      const activities: MetadataDoc['activities'] = [];
      if (lms === 'demo' || quiz_id !== null) activities.push({ kind: 'quiz', instance_id: lms === 'demo' ? 1 : quiz_id!, name: lms === 'demo' ? 'Quiz 1' : 'Quiz', due: end_time });
      if (lms === 'demo' || assignment_id !== null) activities.push({ kind: 'assign', instance_id: lms === 'demo' ? 2 : assignment_id!, name: lms === 'demo' ? 'Essay 1' : 'Assignment', due: end_time });
      const doc: MetadataDoc = {
        version: 1,
        title: title.trim(),
        lms,
        site: clean_site,
        course_id: lms === 'demo' ? 1 : course_id!,
        activities,
        min_grade: null,
      };
      const canonical = canonical_json(doc);
      const hash = keccak256(toBytes(canonical)) as Hex;
      const issued_at = Math.floor(Date.now() / 1000);
      const signature = await client.signMessage({ account: address, message: metadata_message(address, hash, issued_at) });
      const posted = await oracle.post_metadata({ wallet: address, signature, issued_at, metadata: doc });
      const join_deadline = now + join_seconds;
      await run({
        address: addresses.manager,
        abi: abis.manager,
        functionName: 'create_challenge',
        args: [
          stake_token.token,
          stake_token.vault,
          min_stake,
          max_stake,
          BigInt(join_deadline),
          BigInt(end_time),
          600n,
          300n,
          hash,
          posted.metadata_uri,
        ],
      });
    } catch (err) {
      set_msg(explain_error(err, lang));
    } finally {
      set_creating(false);
    }
  }

  return (
    <section className="card flex flex-col gap-3 p-4">
      <h2 className="font-semibold">Create challenge</h2>
      <input className="input" placeholder="Title" maxLength={200} value={title} onChange={(e) => set_title(e.target.value)} />
      <label className="flex flex-col gap-1 text-sm">
        {t(lang, 'admin_lms')}
        <select className="input" value={lms} onChange={(e) => {
          const next = e.target.value === 'moodle' ? 'moodle' : 'demo';
          set_lms(next);
          set_site(next === 'moodle' ? DEFAULT_MOODLE_SITE : 'demo');
        }}>
          <option value="demo">Demo LMS</option>
          <option value="moodle">Moodle</option>
        </select>
      </label>
      <input className="input" placeholder="Site" maxLength={200} value={site} onChange={(e) => set_site(e.target.value)} />
      {lms === 'moodle' ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm">{t(lang, 'admin_moodle_ids')}</legend>
          <input className="input num" inputMode="numeric" placeholder={t(lang, 'admin_course_id')} value={course} onChange={(e) => set_course(e.target.value)} />
          <input className="input num" inputMode="numeric" placeholder={t(lang, 'admin_quiz_id')} value={quiz} onChange={(e) => set_quiz(e.target.value)} />
          <input className="input num" inputMode="numeric" placeholder={t(lang, 'admin_assignment_id')} value={assignment} onChange={(e) => set_assignment(e.target.value)} />
        </fieldset>
      ) : null}
      <select className="input" value={token_key} onChange={(e) => set_token_key(e.target.value as typeof token_key)}>
        {tokens.map((x) => (
          <option key={x.key} value={x.key}>
            {x.label}
          </option>
        ))}
      </select>
      <div className="grid gap-2 min-[480px]:grid-cols-2">
        <input className="input num" placeholder="Join window (min)" value={join_min} onChange={(e) => set_join_min(e.target.value)} />
        <input className="input num" placeholder="Due (hours)" value={due_hours} onChange={(e) => set_due_hours(e.target.value)} />
        <input className="input num" placeholder="Min stake (USDC)" value={min_text} onChange={(e) => set_min(e.target.value)} />
        <input className="input num" placeholder="Max stake (USDC)" value={max_text} onChange={(e) => set_max(e.target.value)} />
      </div>
      <button type="button" className="btn" disabled={!ready || !client || creating} onClick={create}>
        Create
      </button>
      <TxStatusLine state={state} lang={lang} />
      {msg ? <p className="text-sm" style={{ color: 'var(--accent)' }}>{msg}</p> : null}
    </section>
  );
}

function parse_moodle_id(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const id = Number(text);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function SponsorForm({ can_sponsor_manually, treasury, is_treasury }: {
  can_sponsor_manually: boolean;
  treasury?: `0x${string}`;
  is_treasury: boolean;
}) {
  const { lang } = use_ui();
  const qc = useQueryClient();
  const { address, chainId } = useAccount();
  const [id_text, set_id] = useState('');
  const [amount_text, set_amount] = useState('');
  const [error, set_error] = useState<string | null>(null);
  const [busy, set_busy] = useState(false);
  const in_flight = useRef(false);
  const { state, run, reset } = use_tx(lang, () => invalidate_challenge_queries(qc));
  const stats = useQuery({ queryKey: ['x402-stats'], queryFn: oracle.get_x402_stats, enabled: CHAIN_ID === 43113, retry: false });
  const sales = stats.data;
  const revenue = sales && /^\d+$/.test(sales.settled_amount) && isAddress(sales.asset) &&
    isAddressEqual(sales.asset, addresses.circle_usdc) && !!treasury && isAddress(sales.pay_to) && isAddressEqual(sales.pay_to, treasury)
    ? BigInt(sales.settled_amount) : null;
  const amount = parse_usdc(amount_text);
  const id = /^\d+$/.test(id_text.trim()) ? BigInt(id_text.trim()) : null;
  const max_amount = (1n << 128n) - 1n;

  async function sponsor(challenge_id: bigint | null, amount_to_send: bigint | null, from_x402 = false) {
    if (!address || !challenge_id || !amount_to_send || amount_to_send > max_amount || in_flight.current) return;
    in_flight.current = true;
    set_busy(true);
    set_error(null);
    reset();
    try {
      const ch = to_challenge(await public_client.readContract({
        address: addresses.manager, abi: abis.manager, functionName: 'get_challenge', args: [challenge_id],
      }));
      if (from_x402) {
        const current_treasury = await public_client.readContract({ address: addresses.manager, abi: abis.manager, functionName: 'treasury' });
        if (chainId !== CHAIN_ID || !is_treasury || !isAddressEqual(address, current_treasury)) {
          set_error(t(lang, 'x402_sponsor_treasury'));
          return;
        }
        if (!isAddressEqual(ch.token, addresses.circle_usdc)) {
          set_error(t(lang, 'x402_sponsor_asset'));
          return;
        }
        if (ch.status !== 1 || ch.end_time <= BigInt(Math.floor(Date.now() / 1000))) {
          set_error(t(lang, 'x402_sponsor_closed'));
          return;
        }
        const balance = await public_client.readContract({ address: ch.token, abi: abis.token, functionName: 'balanceOf', args: [address] });
        if (balance < amount_to_send) {
          set_error(t(lang, 'x402_sponsor_balance'));
          return;
        }
      }
      const allowance = await public_client.readContract({ address: ch.token, abi: abis.token, functionName: 'allowance', args: [address, addresses.manager] });
      if (allowance < amount_to_send) {
        const approved = await run({ address: ch.token, abi: abis.token, functionName: 'approve', args: [addresses.manager, amount_to_send] });
        if (!approved) return;
      }
      await run({ address: addresses.manager, abi: abis.manager, functionName: 'sponsor', args: [challenge_id, amount_to_send] });
    } catch (err) {
      set_error(explain_error(err, lang));
    } finally {
      in_flight.current = false;
      set_busy(false);
    }
  }

  return (
    <section className="card flex flex-col gap-3 p-4">
      <h2 className="font-semibold">Sponsor</h2>
      <div className="grid gap-2 min-[480px]:grid-cols-2">
        <input className="input num" aria-label={t(lang, 'sponsor_challenge_id')} placeholder={t(lang, 'sponsor_challenge_id')} value={id_text} onChange={(e) => set_id(e.target.value)} />
        {can_sponsor_manually ? <input className="input num" placeholder="Amount (USDC)" value={amount_text} onChange={(e) => set_amount(e.target.value)} /> : null}
      </div>
      {can_sponsor_manually ? (
        <button type="button" className="btn" disabled={busy || !address || !id || !amount || amount > max_amount} onClick={() => void sponsor(id, amount)}>
          Sponsor
        </button>
      ) : null}
      {CHAIN_ID === 43113 ? (
        <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-3">
          <p className="text-sm font-semibold">{t(lang, 'x402_revenue')}</p>
          <p className="text-sm num">{revenue === null ? t(lang, stats.isLoading ? 'loading' : 'error_load') : `${format_usdc(revenue, 6)} USDC`}</p>
          <p className="text-xs text-[var(--muted)]">{t(lang, 'x402_revenue_usage')}</p>
          {is_treasury ? (
            <button type="button" className="btn" disabled={busy || !id || !revenue || revenue > max_amount || chainId !== CHAIN_ID} onClick={() => void sponsor(id, revenue, true)}>
              {t(lang, 'x402_sponsor')}
            </button>
          ) : null}
        </div>
      ) : null}
      {error ? <p role="alert" className="text-sm text-[var(--accent)]">{error}</p> : null}
      <TxStatusLine state={state} lang={lang} />
    </section>
  );
}

function Guardian() {
  const { lang } = use_ui();
  const qc = useQueryClient();
  const { state, run } = use_tx(lang, () => invalidate_challenge_queries(qc));
  const [paused, set_paused] = useState<boolean | null>(null);
  const [loaded, set_loaded] = useState(false);

  async function refresh() {
    const p = (await public_client.readContract({ address: addresses.manager, abi: abis.manager, functionName: 'paused' })) as boolean;
    set_paused(p);
    set_loaded(true);
  }

  return (
    <section className="card flex flex-col gap-3 p-4">
      <h2 className="font-semibold">Guardian</h2>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-ghost" onClick={refresh}>
          {t(lang, 'loading')}
        </button>
        <button
          type="button"
          className="btn"
          disabled={!loaded || paused === true}
          onClick={async () => {
            const hash = await run({ address: addresses.manager, abi: abis.manager, functionName: 'pause' });
            if (hash) await refresh();
          }}
        >
          Pause
        </button>
        <button
          type="button"
          className="btn"
          disabled={!loaded || paused === false}
          onClick={async () => {
            const hash = await run({ address: addresses.manager, abi: abis.manager, functionName: 'unpause' });
            if (hash) await refresh();
          }}
        >
          Unpause
        </button>
      </div>
      <p className="text-xs text-[var(--muted)]">{loaded ? `paused: ${String(paused)}` : ''}</p>
      <TxStatusLine state={state} lang={lang} />
    </section>
  );
}
