// Minimal injected (EIP-1193) connector built on wagmi's createConnector. Used instead of
// `wagmi/connectors` so the Base Account / Coinbase connector code (which needs @x402 packages) is never bundled.
import { createConnector } from 'wagmi';
import { getAddress, type Chain, type EIP1193Provider } from 'viem';

interface InjectedWindow {
  ethereum?: EIP1193Provider & { providers?: EIP1193Provider[] };
  /** Core (Avalanche's wallet) injects its own provider here, next to window.ethereum. */
  avalanche?: EIP1193Provider;
}

function window_provider(source: 'ethereum' | 'avalanche'): EIP1193Provider | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as InjectedWindow;
  return (source === 'avalanche' ? w.avalanche : w.ethereum) ?? null;
}

/** True when the Core extension is installed. */
export function has_core_wallet(): boolean {
  return window_provider('avalanche') !== null;
}

export interface InjectedOptions {
  /** Optional provider target, as passed by @privy-io/wagmi. Falls back to window.ethereum. */
  target?: { provider?: EIP1193Provider; id?: string; name?: string; icon?: string };
  /** Read the provider from window.avalanche (Core) instead of window.ethereum. */
  source?: 'ethereum' | 'avalanche';
}

/** EIP-3085 params so a wallet without the chain (MetaMask has no Fuji by default) can add it. */
function add_chain_params(chain: Chain) {
  return {
    chainId: `0x${chain.id.toString(16)}`,
    chainName: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: chain.rpcUrls.default.http,
    blockExplorerUrls: chain.blockExplorers ? [chain.blockExplorers.default.url] : undefined,
  };
}

export function injected_connector(options: InjectedOptions = {}) {
  const target = options.target;
  const source = options.source ?? 'ethereum';
  const get_provider = (): EIP1193Provider | null => target?.provider ?? window_provider(source);
  return createConnector((config) => ({
    id: target?.id ?? (source === 'avalanche' ? 'core' : 'injected'),
    name: target?.name ?? (source === 'avalanche' ? 'Core' : 'Browser wallet'),
    type: 'injected',

    async setup() {
      return undefined;
    },

    async connect({ chainId } = {}) {
      const provider = get_provider();
      if (!provider) throw new Error('No injected wallet found');
      const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
      const current = (await provider.request({ method: 'eth_chainId' })) as string;
      let id = Number(current);
      if (chainId !== undefined && id !== chainId) {
        await this.switchChain!({ chainId });
        id = chainId;
      }
      return {
        accounts: accounts.map((a) => getAddress(a)),
        chainId: id,
      } as never;
    },

    async disconnect() {
      return undefined;
    },

    async getAccounts() {
      const provider = get_provider();
      if (!provider) return [];
      const accounts = (await provider.request({ method: 'eth_accounts' })) as string[];
      return accounts.map((a) => getAddress(a));
    },

    async getChainId() {
      const provider = get_provider();
      if (!provider) return config.chains[0].id;
      return Number(await provider.request({ method: 'eth_chainId' }));
    },

    async isAuthorized() {
      const accounts = await this.getAccounts();
      return accounts.length > 0;
    },

    async getProvider() {
      return get_provider() as never;
    },

    async switchChain({ chainId }) {
      const provider = get_provider();
      if (!provider) throw new Error('No injected wallet found');
      const chain = config.chains.find((c) => c.id === chainId) ?? config.chains[0];
      try {
        await provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: `0x${chainId.toString(16)}` }],
        });
      } catch (err) {
        // 4902: the wallet does not know this chain yet. Add it, which also switches to it.
        if ((err as { code?: number }).code !== 4902) throw err;
        await provider.request({ method: 'wallet_addEthereumChain', params: [add_chain_params(chain)] } as never);
      }
      return chain;
    },

    onAccountsChanged() {},
    onChainChanged() {},
    onDisconnect() {},
  }));
}
