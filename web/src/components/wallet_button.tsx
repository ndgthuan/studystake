'use client';
// Connect / disconnect button. Privy login when Privy is enabled, otherwise the injected wallet.
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { active_chain } from '@/lib/config';
import { short_address } from '@/lib/verify';
import { t } from '@/lib/i18n';
import { use_ui } from '@/hooks/use_ui';

export function WalletButton() {
  const { lang, privy_enabled } = use_ui();
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();

  if (!isConnected) {
    const injected = connectors[0];
    return (
      <button
        type="button"
        className="btn"
        disabled={isPending || (!injected && !privy_enabled)}
        onClick={() => {
          if (injected) connect({ connector: injected });
        }}
      >
        {t(lang, 'connect')}
      </button>
    );
  }

  const wrong = chainId !== active_chain.id;
  return (
    <div className="flex items-center gap-2">
      {wrong ? (
        <button type="button" className="btn" disabled={switching} onClick={() => switchChain({ chainId: active_chain.id })}>
          {t(lang, 'switch_network')}
        </button>
      ) : null}
      <span className="num text-sm text-[var(--muted)]">{address ? short_address(address) : ''}</span>
      <button type="button" className="btn btn-ghost" onClick={() => disconnect()}>
        {t(lang, 'disconnect')}
      </button>
    </div>
  );
}
