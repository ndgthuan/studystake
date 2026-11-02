// Test-only EIP-1193 provider injected into the page before any app script runs (addInitScript).
// It forwards read calls to Anvil and signs transactions and typed data with an Anvil dev key, so the app
// exercises the real injected-wallet code path. Anvil's public default keys only. Never used on a real network.
import type { Page } from '@playwright/test';

/** An unlocked Anvil account. The provider forwards signing to Anvil, so no private key is needed. */
export interface AnvilAccount {
  address: `0x${string}`;
}

/** Installs window.ethereum for the given account. The page sees it as a normal injected wallet. */
export async function install_injected_wallet(page: Page, rpc_url: string, account: AnvilAccount): Promise<void> {
  await page.addInitScript(
    ({ rpc, acct }) => {
      const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
      let rpc_id = 1;

      async function rpc_call(method: string, params: unknown[] = []) {
        const res = await fetch(rpc, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: rpc_id++, method, params }),
        });
        const json = (await res.json()) as { result?: unknown; error?: { message: string } };
        if (json.error) throw new Error(json.error.message);
        return json.result;
      }

      /** Anvil unlocks its default accounts, so eth_sendTransaction and signing can be forwarded as-is. */
      async function forward(method: string, params: unknown[]) {
        switch (method) {
          case 'eth_requestAccounts':
          case 'eth_accounts':
            return [acct.address];
          case 'eth_chainId':
            return rpc_call('eth_chainId');
          case 'wallet_switchEthereumChain':
          case 'wallet_addEthereumChain':
            return null;
          case 'eth_sendTransaction': {
            const tx = { ...(params[0] as Record<string, unknown>), from: acct.address };
            return rpc_call('eth_sendTransaction', [tx]);
          }
          case 'personal_sign': {
            // EIP-1193 order is [message, address]; Anvil expects the same order, with the account unlocked.
            return rpc_call('personal_sign', [params[0], acct.address]);
          }
          case 'eth_signTypedData_v4':
          case 'eth_signTypedData': {
            return rpc_call('eth_signTypedData_v4', [acct.address, typeof params[1] === 'string' ? params[1] : JSON.stringify(params[1])]);
          }
          default:
            return rpc_call(method, params);
        }
      }

      const provider = {
        isMetaMask: false,
        isInjectedTestWallet: true,
        selectedAddress: acct.address,
        chainId: '0x7a69',
        request: ({ method, params }: { method: string; params?: unknown[] }) => forward(method, params ?? []),
        on(event: string, fn: (...args: unknown[]) => void) {
          if (!listeners.has(event)) listeners.set(event, new Set());
          listeners.get(event)!.add(fn);
          return provider;
        },
        removeListener(event: string, fn: (...args: unknown[]) => void) {
          listeners.get(event)?.delete(fn);
          return provider;
        },
      };

      Object.defineProperty(window, 'ethereum', { value: provider, configurable: true });
      window.dispatchEvent(new Event('ethereum#initialized'));
    },
    { rpc: rpc_url, acct: account },
  );
}
