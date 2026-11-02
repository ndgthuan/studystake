// Public env. Read once here. NEXT_PUBLIC_* values are inlined at build time.
import { defineChain } from 'viem';

export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337');
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? 'http://127.0.0.1:8545';
export const ORACLE_URL = (process.env.NEXT_PUBLIC_ORACLE_URL ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');
export const EXPLORER_URL = (process.env.NEXT_PUBLIC_EXPLORER_URL ?? 'https://testnet.snowtrace.io').replace(/\/+$/, '');
export const PRIVY_APP_ID = (process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '').trim();
export const PRIVY_ENABLED = PRIVY_APP_ID.length > 0;
/** First block to scan for Joined events. Set to the deploy block for the target chain (0 is safe on Anvil). */
export const DEPLOY_FROM_BLOCK = BigInt(process.env.NEXT_PUBLIC_DEPLOY_BLOCK ?? '0');

export const fuji = defineChain({
  id: 43113,
  name: 'Avalanche Fuji',
  nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 },
  rpcUrls: { default: { http: ['https://api.avax-test.network/ext/bc/C/rpc'] } },
  blockExplorers: { default: { name: 'Snowtrace', url: 'https://testnet.snowtrace.io' } },
  testnet: true,
});

export const anvil = defineChain({
  id: 31337,
  name: 'Anvil',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  testnet: true,
});

/** The chain selected by NEXT_PUBLIC_CHAIN_ID. Only Fuji and Anvil are supported. */
export const active_chain = CHAIN_ID === 43113 ? fuji : anvil;

/** Explorer link for a tx or address. Uses the configured explorer for Fuji, nothing for Anvil. */
export function explorer_tx(hash: string): string | null {
  return CHAIN_ID === 43113 ? `${EXPLORER_URL}/tx/${hash}` : null;
}

export function explorer_address(addr: string): string | null {
  return CHAIN_ID === 43113 ? `${EXPLORER_URL}/address/${addr}` : null;
}
