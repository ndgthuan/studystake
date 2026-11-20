'use client';
// Join: amount input with min/max and balance, EIP-2612 permit + join_with_permit when the token supports it,
// otherwise approve + join. tUSDC gets a faucet button, Circle USDC a link to Circle's faucet.
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useAccount, useConfig, useWalletClient } from 'wagmi';
import { getAccount } from '@wagmi/core';
import { type Address, type Hex } from 'viem';
import { use_ui } from '@/hooks/use_ui';
import { use_tx } from '@/hooks/use_tx';
import { invalidate_challenge_queries } from '@/hooks/use_challenge';
import { addresses, abis, public_client } from '@/lib/contracts';
import { format_usdc, parse_usdc } from '@/lib/usdc';
import { CIRCLE_FAUCET_URL, is_tusdc, permit_domain } from '@/lib/tokens';
import { t } from '@/lib/i18n';
import { PayoutLines } from './payout_lines';
import { TxStatusLine } from './tx_status';
import { oracle, OracleError } from '@/lib/oracle';
import type { MoodleAccess } from '@/hooks/use_moodle_session';

const PERMIT_TYPES = {
  Permit: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

interface Props {
  id: bigint;
  token: Address;
  min_stake: bigint;
  max_stake: bigint;
  total_principal: bigint;
  estimated_pot: bigint | null;
  moodle_access?: MoodleAccess;
}

export function JoinForm({ id, token, min_stake, max_stake, total_principal, estimated_pot, moodle_access }: Props) {
  const { lang } = use_ui();
  const { address } = useAccount();
  const config = useConfig();
  const { data: wallet } = useWalletClient();
  const qc = useQueryClient();
  const [text, set_text] = useState('');
  const [local_error, set_local_error] = useState<string | null>(null);
  const [moodle_error, set_moodle_error] = useState(false);
  const [busy, set_busy] = useState(false);
  const submitting = useRef(false);
  const balance_q = useQuery({
    queryKey: ['balance', token, address ?? null],
    enabled: !!address,
    queryFn: () =>
      public_client.readContract({ address: token, abi: abis.token, functionName: 'balanceOf', args: [address!] }) as Promise<bigint>,
  });
  const balance = balance_q.data ?? 0n;

  const on_done = () => invalidate_challenge_queries(qc);
  const { state, run, reset } = use_tx(lang, on_done);

  const amount = parse_usdc(text);
  const in_range = amount !== null && amount >= min_stake && amount <= max_stake;
  const enough = amount !== null && amount <= balance;
  const unit = is_tusdc(token) ? 'tUSDC' : 'USDC';
  // Offer test tokens up front when the wallet cannot cover even the minimum stake.
  const show_faucet_early = is_tusdc(token) && balance_q.isSuccess && balance < min_stake && !(amount !== null && in_range && !enough);

  /**
   * Permit path: one signature, then join_with_permit (one tx). Approve path: approve, then join.
   * Each on-chain step runs through use_tx. A failed step stops the flow so join never runs unapproved.
   */
  async function submit() {
    if (submitting.current) return;
    set_local_error(null);
    set_moodle_error(false);
    if (!address || !wallet || amount === null) return;
    if (!in_range || !enough) return;
    submitting.current = true;
    set_busy(true);
    try {
      if (moodle_access) {
        try {
          const session = await moodle_access.authorize();
          const check = await oracle.check_join(Number(id), address, session);
          if (check?.ok !== true) throw new Error('Moodle activity access not confirmed');
        } catch (err) {
          if (err instanceof OracleError && err.status === 401) moodle_access.clear();
          set_moodle_error(true);
          return;
        }
      }
      if (getAccount(config).address !== address) return;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
      if (await supports_eip2612(token)) {
        const nonce = (await public_client.readContract({
          address: token,
          abi: abis.token,
          functionName: 'nonces',
          args: [address],
        })) as bigint;
        const domain = await permit_domain(token);
        const sig = await wallet.signTypedData({
          account: address,
          domain,
          types: PERMIT_TYPES,
          primaryType: 'Permit',
          message: { owner: address, spender: addresses.manager, value: amount, nonce, deadline },
        });
        const { v, r, s } = split_sig(sig);
        if (getAccount(config).address !== address) return;
        await run({
          address: addresses.manager,
          abi: abis.manager,
          functionName: 'join_with_permit',
          args: [id, amount, deadline, v, r, s],
        });
        return;
      }
      const approved = await run({ address: token, abi: abis.token, functionName: 'approve', args: [addresses.manager, amount] });
      if (approved === null || getAccount(config).address !== address) return;
      await run({ address: addresses.manager, abi: abis.manager, functionName: 'join', args: [id, amount] });
    } catch (err) {
      set_local_error(err instanceof Error ? err.message : String(err));
    } finally {
      submitting.current = false;
      set_busy(false);
    }
  }

  return (
    <section id="join" className="card flex flex-col gap-3 p-4">
      <h2 className="font-semibold">{t(lang, 'join')}</h2>
      <label className="flex flex-col gap-1 text-sm">
        <span>{t(lang, 'join_amount')}</span>
        <input
          className="input num"
          inputMode="decimal"
          placeholder={`${format_usdc(min_stake)} – ${format_usdc(max_stake)}`}
          value={text}
          onChange={(e) => set_text(e.target.value)}
        />
      </label>
      <div className="num text-sm text-[var(--muted)]">
        {t(lang, 'balance')}: {format_usdc(balance)} {unit}
      </div>
      {show_faucet_early ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>{t(lang, 'need_usdc')}</span>
          <FaucetButton />
        </div>
      ) : null}
      {amount !== null && amount > 0n && in_range && <>
        <PayoutLines lang={lang} unit={unit} principal={null} estimate={estimated_pot === null ? null : estimated_pot * amount / (total_principal + amount)} />
        <small>{t(lang, 'stake_risk')}</small>
      </>}
      {amount !== null && !in_range ? (
        <p className="text-sm" style={{ color: 'var(--accent)' }}>
          {format_usdc(min_stake)} – {format_usdc(max_stake)} {unit}
        </p>
      ) : null}
      {amount !== null && in_range && !enough ? (
        <div className="flex flex-wrap items-center gap-2 text-sm" style={{ color: 'var(--accent)' }}>
          <span>{t(lang, 'need_usdc')}</span>
          {is_tusdc(token) ? (
            <FaucetButton />
          ) : (
            <a className="underline" href={CIRCLE_FAUCET_URL} target="_blank" rel="noreferrer">
              {t(lang, 'faucet_circle')}
            </a>
          )}
        </div>
      ) : null}
      {moodle_access && <small>{t(lang, 'moodle_preflight_help')}</small>}
      <button type="button" className="btn" disabled={!in_range || !enough || !wallet || busy || state.status === 'pending'} onClick={submit}>
        {t(lang, 'join')}
      </button>
      {moodle_error && <div role="alert">
        <p>{t(lang, 'moodle_preflight_failed')}</p>
        <Link className="record-link" href={`/link?challenge=${id}`}>{t(lang, 'link_title')} ↗</Link>
      </div>}
      <TxStatusLine state={state} lang={lang} />
      {!busy && state.status !== 'idle' ? (
        <button type="button" className="btn btn-ghost" onClick={reset}>
          OK
        </button>
      ) : null}
      {local_error ? <p className="text-sm" style={{ color: 'var(--accent)' }}>{local_error}</p> : null}
    </section>
  );
}

/** tUSDC faucet button. Calls faucet() on the test token. The contract enforces the cooldown. */
function FaucetButton() {
  const { lang } = use_ui();
  const qc = useQueryClient();
  const { state, run } = use_tx(lang, () => qc.invalidateQueries({ queryKey: ['balance'] }));
  return (
    <div className="inline-flex flex-col gap-1">
      <button type="button" className="btn btn-ghost" onClick={() => run({ address: addresses.tusdc, abi: abis.token, functionName: 'faucet' })}>
        {t(lang, 'faucet_get')}
      </button>
      <TxStatusLine state={state} lang={lang} />
    </div>
  );
}

async function supports_eip2612(token: `0x${string}`): Promise<boolean> {
  try {
    await public_client.readContract({ address: token, abi: abis.token, functionName: 'DOMAIN_SEPARATOR' });
    return true;
  } catch {
    return false;
  }
}

function split_sig(sig: Hex) {
  const r = `0x${sig.slice(2, 66)}` as Hex;
  const s = `0x${sig.slice(66, 130)}` as Hex;
  const v = Number.parseInt(sig.slice(130, 132), 16);
  return { v, r, s };
}
