import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const connectors_shim = fileURLToPath(new URL('./src/lib/wagmi_connectors_shim.ts', import.meta.url));
const stripe_stub = fileURLToPath(new URL('./src/lib/stripe_stub.ts', import.meta.url));
const farcaster_stub = fileURLToPath(new URL('./src/lib/farcaster_stub.ts', import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  webpack(config) {
    // These optional dependencies are not installed (npm --legacy-peer-deps leaves them out). Each one is only
    // reached through a feature StudyStake does not use, so a stub keeps the bundle buildable:
    //  - wagmi/connectors: @privy-io/wagmi needs `injected`; the barrel pulls Base Account (needs @x402 packages).
    //  - @stripe/stripe-js: Privy's fiat on-ramp screen.
    //  - @farcaster/mini-app-solana: Privy's optional Solana wallet registration (dynamic import in try/catch).
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      'wagmi/connectors$': connectors_shim,
      '@stripe/stripe-js$': stripe_stub,
      '@farcaster/mini-app-solana$': farcaster_stub,
    };
    return config;
  },
};

export default nextConfig;
