// Stand-in for @farcaster/mini-app-solana. Privy loads it with a dynamic import inside try/catch only to
// register an optional Solana wallet. StudyStake is EVM-only, so rejecting is correct and harmless.
export function reject_unavailable(): Promise<never> {
  return Promise.reject(new Error('farcaster mini-app solana is not enabled in StudyStake'));
}

const stub = { reject_unavailable };
export default stub;
