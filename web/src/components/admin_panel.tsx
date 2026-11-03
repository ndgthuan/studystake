'use client';
// Minimal admin: create challenge (metadata signed and posted to the oracle first), sponsor, pause/unpause,
// resolve dispute. Shown only to wallets with CREATOR_ROLE or GUARDIAN_ROLE on chain.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAccount, useWalletClient } from 'wagmi';
import { keccak256, toBytes, type Hex } from 'viem';
import { use_ui } from '@/hooks/use_ui';
import { use_tx } from '@/hooks/use_tx';
import { use_roles } from '@/hooks/use_roles';
import { invalidate_challenge_queries } from '@/hooks/use_challenge';
import { addresses, abis, public_client, to_challenge } from '@/lib/contracts';
import { stake_tokens } from '@/lib/tokens';
import { canonical_json } from '@/lib/canonical';
import { metadata_message } from '@/lib/messages';
import { oracle, type MetadataDoc } from '@/lib/oracle';
import { parse_usdc } from '@/lib/usdc';
import { explain_error } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { TxStatusLine } from './tx_status';

export function AdminPanel() {
  const { lang } = use_ui();
  const { address } = useAccount();
  const { creator, guardian, is_admin, loading } = use_roles();

  if (!address) return <p className="text-[var(--muted)]">{t(lang, 'connect')}</p>;
  if (loading) return <p className="text-[var(--muted)]">{t(lang, 'loading')}</p>;
  if (!is_admin) return <p className="text-[var(--muted)]">{t(lang, 'admin_no_role')}</p>;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{t(lang, 'admin_title')}</h1>
      {creator ? <CreateChallenge /> : null}
      {creator ? <SponsorForm /> : null}
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
  const [site, set_site] = useState('demo');
  const [due_hours, set_due_hours] = useState('1');
  const [join_min, set_join_min] = useState('5');
  const [min_text, set_min] = useState('1');
  const [max_text, set_max] = useState('500');
  const tokens = stake_tokens();
  const [token_key, set_token_key] = useState(tokens[0]!.key);
  const stake_token = tokens.find((x) => x.key === token_key) ?? tokens[0]!;
  const [msg, set_msg] = useState<string | null>(null);

  async function create() {
    if (!address || !client) return;
    set_msg(null);
    try {
      const now = Math.floor(Date.now() / 1000);
      const end_time = now + Math.round(Number(due_hours) * 3600);
      const doc: MetadataDoc = {
        version: 1,
        title,
        lms: 'demo',
        site,
        course_id: 1,
        activities: [
          { kind: 'quiz', instance_id: 1, name: 'Quiz 1', due: end_time },
          { kind: 'assign', instance_id: 2, name: 'Essay 1', due: end_time },
        ],
        min_grade: null,
      };
      const canonical = canonical_json(doc);
      const hash = keccak256(toBytes(canonical)) as Hex;
      const issued_at = Math.floor(Date.now() / 1000);
      const signature = await client.signMessage({ account: address, message: metadata_message(address, hash, issued_at) });
      const posted = await oracle.post_metadata({ wallet: address, signature, issued_at, metadata: doc });
      const join_deadline = now + Math.round(Number(join_min) * 60);
      const min_stake = parse_usdc(min_text) ?? 0n;
      const max_stake = parse_usdc(max_text) ?? 0n;
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
    }
  }

  return (
    <section className="card flex flex-col gap-3 p-4">
      <h2 className="font-semibold">Create challenge</h2>
      <input className="input" placeholder="Title" value={title} onChange={(e) => set_title(e.target.value)} />
      <input className="input" placeholder="Site" value={site} onChange={(e) => set_site(e.target.value)} />
      <select className="input" value={token_key} onChange={(e) => set_token_key(e.target.value as typeof token_key)}>
        {tokens.map((x) => (
          <option key={x.key} value={x.key}>
            {x.label}
          </option>
        ))}
      </select>
      <div className="grid grid-cols-2 gap-2">
        <input className="input num" placeholder="Join window (min)" value={join_min} onChange={(e) => set_join_min(e.target.value)} />
        <input className="input num" placeholder="Due (hours)" value={due_hours} onChange={(e) => set_due_hours(e.target.value)} />
        <input className="input num" placeholder="Min stake (USDC)" value={min_text} onChange={(e) => set_min(e.target.value)} />
        <input className="input num" placeholder="Max stake (USDC)" value={max_text} onChange={(e) => set_max(e.target.value)} />
      </div>
      <button type="button" className="btn" disabled={title.trim().length === 0} onClick={create}>
        Create
      </button>
      <TxStatusLine state={state} lang={lang} />
      {msg ? <p className="text-sm" style={{ color: 'var(--accent)' }}>{msg}</p> : null}
    </section>
  );
}

function SponsorForm() {
  const { lang } = use_ui();
  const qc = useQueryClient();
  const { address } = useAccount();
  const [id_text, set_id] = useState('');
  const [amount_text, set_amount] = useState('');
  const { state, run } = use_tx(lang, () => invalidate_challenge_queries(qc));
  const amount = parse_usdc(amount_text);
  const id = /^\d+$/.test(id_text) ? BigInt(id_text) : null;
  return (
    <section className="card flex flex-col gap-3 p-4">
      <h2 className="font-semibold">Sponsor</h2>
      <div className="grid grid-cols-2 gap-2">
        <input className="input num" placeholder="Challenge id" value={id_text} onChange={(e) => set_id(e.target.value)} />
        <input className="input num" placeholder="Amount (USDC)" value={amount_text} onChange={(e) => set_amount(e.target.value)} />
      </div>
      <p className="text-xs text-[var(--muted)]">Approves the challenge token first when the allowance is too low.</p>
      <button
        type="button"
        className="btn"
        disabled={!address || id === null || amount === null || amount === 0n}
        onClick={async () => {
          const ch = to_challenge(
            await public_client.readContract({ address: addresses.manager, abi: abis.manager, functionName: 'get_challenge', args: [id!] }),
          );
          const allowance = (await public_client.readContract({
            address: ch.token,
            abi: abis.token,
            functionName: 'allowance',
            args: [address!, addresses.manager],
          })) as bigint;
          if (allowance < amount!) {
            const approved = await run({ address: ch.token, abi: abis.token, functionName: 'approve', args: [addresses.manager, amount!] });
            if (approved === null) return;
          }
          await run({ address: addresses.manager, abi: abis.manager, functionName: 'sponsor', args: [id!, amount!] });
        }}
      >
        Sponsor
      </button>
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
