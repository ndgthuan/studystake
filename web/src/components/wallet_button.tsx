'use client';
// Connect / disconnect button. Privy login (Google, email or an external wallet) when Privy is enabled,
// otherwise the injected wallets: Core when installed, plus any browser wallet.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { usePrivy, type User } from '@privy-io/react-auth';
import { formatEther, parseEther, type Address } from 'viem';
import { active_chain, CHAIN_ID, explorer_tx } from '@/lib/config';
import { has_core_wallet } from '@/lib/injected_connector';
import { public_client } from '@/lib/contracts';
import { oracle, OracleError } from '@/lib/oracle';
import { short_address } from '@/lib/verify';
import { t, type Lang } from '@/lib/i18n';
import { use_ui } from '@/hooks/use_ui';

/** Same eligibility threshold as the oracle faucet. */
const LOW_GAS_WEI = parseEther('0.02');

export function WalletButton() {
  const { privy_enabled } = use_ui();
  return privy_enabled ? <PrivyWalletButton /> : <InjectedWalletButton />;
}

function InjectedWalletButton() {
  const { lang } = use_ui();
  const { isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  // window.avalanche only exists in the browser, so check after mount to keep SSR and hydration equal.
  const [core, set_core] = useState(false);
  useEffect(() => set_core(has_core_wallet()), []);

  if (isConnected) return <Connected />;

  const injected = connectors.find((c) => c.id === 'injected');
  const core_connector = connectors.find((c) => c.id === 'core');
  return (
    <div className="wallet-controls flex flex-wrap items-center justify-end gap-2">
      {core && core_connector ? (
        <button type="button" className="btn" disabled={isPending} onClick={() => connect({ connector: core_connector })}>
          {t(lang, 'connect_core')}
        </button>
      ) : null}
      <button
        type="button"
        className={core ? 'btn btn-ghost' : 'btn'}
        disabled={isPending || !injected}
        onClick={() => {
          if (injected) connect({ connector: injected });
        }}
      >
        {t(lang, 'connect')}
      </button>
    </div>
  );
}

function PrivyWalletButton() {
  const { lang } = use_ui();
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { address } = useAccount();
  if (!ready) return <button type="button" className="btn" disabled>{t(lang, 'login')}</button>;
  if (!authenticated) {
    return (
      <button type="button" className="btn" onClick={() => login()}>
        {t(lang, 'login')}
      </button>
    );
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <Connected profile={user} on_logout={() => void logout()} />
      {address ? <GasDrip key={address} address={address} lang={lang} /> : null}
    </div>
  );
}

function Connected({ profile, on_logout }: {
  profile?: Pick<User, 'google' | 'email'> | null;
  on_logout?: () => void;
}) {
  const { lang } = use_ui();
  const { address, chainId } = useAccount();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const wrong = chainId !== undefined && chainId !== active_chain.id;
  const google = profile?.google;
  const email = profile?.email?.address;
  const account_type = google ? 'account_google' : email ? 'account_email' : address ? 'account_wallet' : 'account';
  const display_name = google?.name?.trim() || (!google && !email && address ? short_address(address) : '');

  return (
    <div className="wallet-controls flex flex-wrap items-center justify-end gap-2">
      {wrong ? (
        <button type="button" className="btn" disabled={switching} onClick={() => switchChain({ chainId: active_chain.id })}>
          {t(lang, 'switch_network')}
        </button>
      ) : null}
      <details
        className="wallet-account"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && event.currentTarget.open) {
            event.currentTarget.open = false;
            event.currentTarget.querySelector('summary')?.focus();
          }
        }}
      >
        <summary className="btn btn-ghost account-trigger">
          <span className="account-label">
            <strong>{display_name || t(lang, account_type)}</strong>
            {display_name && <small>{t(lang, account_type)}</small>}
          </span>
        </summary>
        <div className="account-panel">
          <dl>
            {google && <div><dt>{t(lang, 'account_google')}</dt><dd>{google.email}</dd></div>}
            {email && email !== google?.email && <div><dt>{t(lang, 'account_email')}</dt><dd>{email}</dd></div>}
            {address && <div><dt>{t(lang, 'account_wallet')}</dt><dd className="num">{address}</dd></div>}
          </dl>
          <button type="button" className="btn btn-ghost" onClick={() => (on_logout ? on_logout() : disconnect())}>
            {t(lang, on_logout ? 'logout' : 'disconnect')}
          </button>
        </div>
      </details>
    </div>
  );
}

const SILENT_FAUCET_CODES = new Set(['already_funded', 'user_already_claimed', 'wallet_already_claimed']);
const drip_key = (address: Address) => `studystake:gas_drip:${address.toLowerCase()}`;

/** True when this browser already saw a faucet grant (or an "already claimed" answer) for the wallet. */
function read_drip_done(address: Address): boolean {
  try {
    return window.localStorage.getItem(drip_key(address)) === '1';
  } catch {
    return false;
  }
}

function mark_drip_done(address: Address): void {
  try {
    window.localStorage.setItem(drip_key(address), '1');
  } catch {
    // Storage can be blocked; the oracle still refuses a second grant.
  }
}

type DripState = { status: 'idle' | 'sending' | 'failed' } | { status: 'sent'; tx_hash: string; amount: string };

/**
 * After a Privy login on Fuji, asks the oracle faucet for gas once if the wallet holds less than 0.02 AVAX.
 * The oracle enforces one grant per Privy user and per wallet; this only avoids pointless requests.
 */
function GasDrip({ address, lang }: { address: Address; lang: Lang }) {
  const { getAccessToken } = usePrivy();
  const [state, set_state] = useState<DripState>({ status: 'idle' });
  const requested = useRef(false);

  useEffect(() => {
    if (CHAIN_ID !== 43113 || requested.current) return;
    // Guarded by a ref, not a cleanup flag: a StrictMode re-run must not drop the result of the one request.
    requested.current = true;
    if (read_drip_done(address)) return;
    void (async () => {
      try {
        if (await public_client.getBalance({ address }) >= LOW_GAS_WEI) return;
        set_state({ status: 'sending' });
        const jwt = await getAccessToken();
        if (!jwt) throw new Error('Privy access token unavailable');
        const res = await oracle.post_faucet({ wallet: address }, jwt);
        const receipt = await public_client.waitForTransactionReceipt({ hash: res.tx_hash, timeout: 45_000 });
        if (receipt.status !== 'success') throw new Error('Faucet transaction failed');
        mark_drip_done(address);
        set_state({ status: 'sent', tx_hash: res.tx_hash, amount: formatEther(BigInt(res.amount_wei)) });
      } catch (err) {
        // The oracle grants gas once per account and wallet; a repeat request is not a failure.
        if (err instanceof OracleError && SILENT_FAUCET_CODES.has(err.code)) {
          if (err.code !== 'already_funded') mark_drip_done(address);
          set_state({ status: 'idle' });
          return;
        }
        set_state({ status: 'failed' });
      }
    })();
  }, [address, getAccessToken]);

  if (state.status === 'idle') return null;
  if (state.status === 'failed') {
    return (
      <p className="text-xs text-[var(--muted)]">
        {t(lang, 'gas_failed')}{' '}
        <Link className="underline" href="/me#fuji-wallet">{t(lang, 'fuji_wallet')}</Link>
      </p>
    );
  }
  if (state.status !== 'sent') return <p className="text-xs text-[var(--muted)]">{t(lang, 'gas_sending')}</p>;
  const link = explorer_tx(state.tx_hash);
  return (
    <p role="status" className="text-xs text-[var(--muted)]">
      {t(lang, 'gas_sent').replace('{amount}', state.amount)}{' '}
      {link ? <a className="underline" href={link} target="_blank" rel="noreferrer">{t(lang, 'view_explorer')}</a> : null}
    </p>
  );
}
