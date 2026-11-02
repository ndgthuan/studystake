// Stand-in for `wagmi/connectors`. next.config.ts aliases that specifier here so @privy-io/wagmi receives
// only `injected`, without bundling Base Account / Coinbase code (it needs @x402 packages not installed).
// Add other exports here only if a dependency needs them.
export { injected_connector as injected } from './injected_connector';
