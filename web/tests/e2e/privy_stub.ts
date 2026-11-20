// Test-only stand-ins for Privy's server and a browser wallet, so the real Privy client code can run a wallet login with
// no Privy account and no network. Covers the external wallet path only: Google, email and embedded wallets need the
// real server. The token is unsigned because only the client reads it here, and nothing real ever accepts it.
import type { Page } from '@playwright/test';

/** Anvil's public default account #1. */
export const STUB_WALLET_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

type GoogleProfile = { name: string; email: string };

function fake_session(app_id: string, google?: GoogleProfile) {
  const now = Math.floor(Date.now() / 1000);
  const claims = { sid: 'stub', iss: 'privy.io', iat: now, aud: app_id, sub: 'did:privy:stub', exp: now + 3600 };
  const token = `${encode({ alg: 'ES256', typ: 'JWT' })}.${encode(claims)}.c3R1Yg`;
  return {
    user: {
      id: 'did:privy:stub',
      created_at: now,
      has_accepted_terms: true,
      is_guest: false,
      mfa_methods: [],
      linked_accounts: [
        {
          type: 'wallet',
          address: STUB_WALLET_ADDRESS,
          chain_type: 'ethereum',
          wallet_client_type: 'unknown',
          connector_type: 'injected',
          verified_at: now,
          first_verified_at: now,
          latest_verified_at: now,
        },
        ...(google ? [{
          type: 'google_oauth', subject: 'stub-google', ...google,
          verified_at: now, first_verified_at: now, latest_verified_at: now,
        }] : []),
      ],
    },
    token,
    privy_access_token: token,
    refresh_token: null,
    identity_token: null,
    session_update_action: 'set',
    is_new_user: false,
  };
}

/** Answers every Privy and WalletConnect request in the browser. Anything not listed here gets a 404. */
export async function stub_privy_server(page: Page, app_id: string, google_enabled = true, google?: GoogleProfile): Promise<void> {
  await page.route(/privy\.io|walletconnect|reown/, (route) => {
    const url = route.request().url();
    if (url.includes(`/api/v1/apps/${app_id}`)) {
      return route.fulfill({
        json: {
          id: app_id,
          name: 'StudyStake test',
          wallet_auth: true,
          email_auth: true,
          google_oauth: google_enabled,
          allowlist_config: { error_title: null, error_detail: null, cta_text: null, cta_link: null },
          embedded_wallet_config: {
            create_on_login: 'off',
            ethereum: { create_on_login: 'off' },
            solana: { create_on_login: 'off' },
            require_user_owned_recovery_on_create: false,
            user_owned_recovery_options: ['user-passcode'],
            mode: 'user-controlled-server-wallets-only',
          },
        },
      });
    }
    if (url.includes('/api/v1/siwe/init')) {
      const expires_at = new Date(Date.now() + 600_000).toISOString();
      return route.fulfill({ json: { nonce: 'stub-nonce', address: STUB_WALLET_ADDRESS, expires_at } });
    }
    if (url.includes('/api/v1/siwe/authenticate')) return route.fulfill({ json: fake_session(app_id, google) });
    return route.fulfill({ status: 404, json: { error: 'stubbed' } });
  });
}

/** A window.ethereum that needs no chain: it reports Anvil's chain id and returns a dummy signature for the login. */
export async function install_stub_wallet(page: Page): Promise<void> {
  await page.addInitScript((address) => {
    const answers: Record<string, unknown> = {
      eth_requestAccounts: [address],
      eth_accounts: [address],
      eth_chainId: '0x7a69',
      personal_sign: `0x${'ab'.repeat(65)}`,
      wallet_switchEthereumChain: null,
      wallet_addEthereumChain: null,
    };
    const provider = {
      selectedAddress: address,
      chainId: '0x7a69',
      request: async ({ method }: { method: string }) => {
        if (method in answers) return answers[method];
        throw new Error(`stub wallet does not support ${method}`);
      },
      on: () => provider,
      removeListener: () => provider,
    };
    Object.defineProperty(window, 'ethereum', { value: provider, configurable: true });
  }, STUB_WALLET_ADDRESS);
}
