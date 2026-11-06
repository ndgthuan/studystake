'use client';
// Providers. With NEXT_PUBLIC_PRIVY_APP_ID set: Privy + wagmi (embedded wallet and external wallets).
// Without it: plain wagmi with an injected connector only, so local and E2E runs need no Privy.
import { useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { injected_connector } from '@/lib/injected_connector';
import { PrivyProvider } from '@privy-io/react-auth';
import { WagmiProvider as PrivyWagmiProvider, createConfig as createPrivyWagmiConfig } from '@privy-io/wagmi';
import { active_chain, PRIVY_APP_ID, PRIVY_ENABLED, RPC_URL } from '@/lib/config';
import type { Lang } from '@/lib/i18n';
import { UiCtx, type Theme, type UiContext } from '@/hooks/use_ui';

function read_pref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = window.localStorage.getItem(key);
    return v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function write_pref(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // storage unavailable (private window): preference is kept for this page view only
  }
}

// wagmi types require a transport for every chain in the union. Only the active chain is used at runtime.
const transports = {
  43113: http(RPC_URL),
  31337: http(RPC_URL),
} as const;

const injected_config = createConfig({
  chains: [active_chain],
  connectors: [injected_connector({ source: 'avalanche' }), injected_connector()],
  transports,
});

function build_privy_config() {
  return createPrivyWagmiConfig({
    chains: [active_chain],
    transports,
  });
}

export function Providers({ children }: { children: ReactNode }) {
  const [query_client] = useState(() => new QueryClient());
  // The first client render must match the server HTML, which cannot know the saved values. Reading localStorage in
  // the useState initializers instead would make hydration fail for anyone with a saved preference.
  const [lang, set_lang_state] = useState<Lang>('vi');
  const [theme, set_theme_state] = useState<Theme>('dark');

  useEffect(() => {
    set_lang_state(read_pref<Lang>('ss_lang', ['vi', 'en'], 'vi'));
    set_theme_state(read_pref<Theme>('ss_theme', ['dark', 'light'], 'dark'));
  }, []);

  const set_lang = (l: Lang) => {
    write_pref('ss_lang', l);
    set_lang_state(l);
  };
  const set_theme = (t: Theme) => {
    write_pref('ss_theme', t);
    set_theme_state(t);
  };

  const ui: UiContext = { lang, set_lang, theme, set_theme, privy_enabled: PRIVY_ENABLED };

  const inner = (
    <QueryClientProvider client={query_client}>
      <UiCtx.Provider value={ui}>{children}</UiCtx.Provider>
    </QueryClientProvider>
  );

  if (!PRIVY_ENABLED) {
    return (
      <WagmiProvider config={injected_config}>
        {inner}
      </WagmiProvider>
    );
  }

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ['google', 'email', 'wallet'],
        embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' } },
        appearance: { theme: 'dark' },
        defaultChain: active_chain,
        supportedChains: [active_chain],
      }}
    >
      <PrivyWagmiProvider config={build_privy_config()}>{inner}</PrivyWagmiProvider>
    </PrivyProvider>
  );
}
