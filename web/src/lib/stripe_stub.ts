// Stand-in for @stripe/stripe-js. Pulled in only by Privy's fiat on-ramp (@stripe/crypto), which this app
// never shows. next.config.ts aliases the package here so the build does not need the real SDK.
export function loadStripe(): Promise<null> {
  return Promise.reject(new Error('fiat on-ramp is not enabled in StudyStake'));
}
