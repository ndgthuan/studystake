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
import { THEME_COLORS } from '@/lib/theme';
import { UiCtx, type Theme, type UiContext } from '@/hooks/use_ui';
import { ActionNotices } from './action_notices';

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
  ssr: true,
  chains: [active_chain],
  connectors: [injected_connector({ source: 'avalanche' }), injected_connector()],
  transports,
});

// One config for the page's lifetime. wagmi keeps the wallet connection inside this object, and a new one has an empty
// store that Privy's wagmi bridge does not fill again, so creating it per render would disconnect on every toggle.
const privy_wagmi_config = PRIVY_ENABLED ? createPrivyWagmiConfig({ ssr: true, chains: [active_chain], transports }) : null;

function apply_theme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = THEME_COLORS[theme];
}

export function Providers({ children }: { children: ReactNode }) {
  const [query_client] = useState(() => new QueryClient());
  // The first client render must match the server HTML, which cannot know the saved values. Reading localStorage in
  // the useState initializers instead would make hydration fail for anyone with a saved preference.
  const [lang, set_lang_state] = useState<Lang>('vi');
  const [theme, set_theme_state] = useState<Theme>('light');

  // Reconcile the document with the saved preferences if React replaced the initial markup.
  useEffect(() => {
    const language = read_pref<Lang>('ss_lang', ['vi', 'en'], 'vi');
    const appearance = read_pref<Theme>('ss_theme', ['dark', 'light'], 'light');
    document.documentElement.lang = language;
    apply_theme(appearance);
    set_lang_state(language);
    set_theme_state(appearance);
  }, []);

  const set_lang = (l: Lang) => {
    write_pref('ss_lang', l);
    set_lang_state(l);
    document.documentElement.setAttribute('lang', l);
  };
  const set_theme = (t: Theme) => {
    write_pref('ss_theme', t);
    set_theme_state(t);
    apply_theme(t);
  };

  const ui: UiContext = { lang, set_lang, theme, set_theme, privy_enabled: PRIVY_ENABLED };

  const inner = <UiCtx.Provider value={ui}><ActionNotices>{children}</ActionNotices></UiCtx.Provider>;

  if (!privy_wagmi_config) {
    return (
      <WagmiProvider config={injected_config}>
        <QueryClientProvider client={query_client}>{inner}</QueryClientProvider>
      </WagmiProvider>
    );
  }

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        // Privy uses the methods enabled for this app in its dashboard.
        // Overriding this list can offer a provider that the auth server rejects.
        embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' } },
        appearance: { theme },
        defaultChain: active_chain,
        supportedChains: [active_chain],
      }}
    >
      {/* Must wrap PrivyWagmiProvider, which uses react-query hooks itself. The build fails otherwise. */}
      <QueryClientProvider client={query_client}>
        <PrivyWagmiProvider config={privy_wagmi_config}>{inner}</PrivyWagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
