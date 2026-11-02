'use client';
// Join: amount input with min/max and balance, EIP-2612 permit + join_with_permit when the token supports it,
// otherwise approve + join. tUSDC gets a faucet button.
import { useState } from 'react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useAccount, useWalletClient } from 'wagmi';
import { getAddress, type Hex } from 'viem';
import { use_ui } from '@/hooks/use_ui';
import { use_tx } from '@/hooks/use_tx';
import { invalidate_challenge_queries } from '@/hooks/use_challenge';
import { addresses, abis, public_client } from '@/lib/contracts';
import { format_usdc, parse_usdc } from '@/lib/usdc';
import { t } from '@/lib/i18n';
import { TxStatusLine } from './tx_status';

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
  min_stake: bigint;
  max_stake: bigint;
}

export function JoinForm({ id, min_stake, max_stake }: Props) {
  const { lang } = use_ui();
  const { address } = useAccount();
  const { data: wallet } = useWalletClient();
  const qc = useQueryClient();
  const [text, set_text] = useState('');
  const [local_error, set_local_error] = useState<string | null>(null);
  // The demo joins tUSDC only, so the faucet is always offered. A real USDC pool would hide it.
  const token = addresses.tusdc;
  const is_tusdc = true;

  const balance_q = useQuery({
    queryKey: ['balance', address ?? null],
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

  /**
   * Permit path: one signature, then join_with_permit (one tx). Approve path: approve, then join.
   * Each on-chain step runs through use_tx. A failed step stops the flow so join never runs unapproved.
   */
  async function submit() {
    set_local_error(null);
    if (!address || !wallet || amount === null) return;
    if (!in_range || !enough) return;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
    try {
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
        await run({
          address: addresses.manager,
          abi: abis.manager,
          functionName: 'join_with_permit',
          args: [id, amount, deadline, v, r, s],
        });
        return;
      }
      const approved = await run({ address: token, abi: abis.token, functionName: 'approve', args: [addresses.manager, amount] });
      if (approved === null) return;
      await run({ address: addresses.manager, abi: abis.manager, functionName: 'join', args: [id, amount] });
    } catch (err) {
      set_local_error(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section className="card flex flex-col gap-3 p-4">
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
        {t(lang, 'balance')}: {format_usdc(balance)} USDC
      </div>
      {amount !== null && !in_range ? (
        <p className="text-sm" style={{ color: 'var(--accent)' }}>
          {format_usdc(min_stake)} – {format_usdc(max_stake)} USDC
        </p>
      ) : null}
      {amount !== null && in_range && !enough ? (
        <p className="text-sm" style={{ color: 'var(--accent)' }}>
          {t(lang, 'need_usdc')}
          {is_tusdc ? (
            <FaucetButton />
          ) : null}
        </p>
      ) : null}
      <button type="button" className="btn" disabled={!in_range || !enough || state.status === 'signing' || state.status === 'pending'} onClick={submit}>
        {t(lang, 'join')}
      </button>
      <TxStatusLine state={state} lang={lang} />
      {state.status !== 'idle' ? (
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
    <span className="ml-2 inline-flex flex-col gap-1">
      <button type="button" className="btn btn-ghost" onClick={() => run({ address: addresses.tusdc, abi: abis.token, functionName: 'faucet' })}>
        {t(lang, 'faucet_get')}
      </button>
      <TxStatusLine state={state} lang={lang} />
    </span>
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

async function permit_domain(token: `0x${string}`) {
  const name = (await public_client.readContract({ address: token, abi: abis.token, functionName: 'name' })) as string;
  return { name, version: '1', chainId: public_client.chain!.id, verifyingContract: getAddress(token) };
}

function split_sig(sig: Hex) {
  const r = `0x${sig.slice(2, 66)}` as Hex;
  const s = `0x${sig.slice(66, 130)}` as Hex;
  const v = Number.parseInt(sig.slice(130, 132), 16);
  return { v, r, s };
}
