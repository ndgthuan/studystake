// USDC / tUSDC amount formatting. Both tokens use 6 decimals.
export const USDC_DECIMALS = 6;

/** Formats base units to a display string with up to `max_frac` fraction digits, e.g. 1500000n -> "1.5". */
export function format_usdc(amount: bigint, max_frac = 2): string {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const scale = 10n ** BigInt(USDC_DECIMALS);
  const whole = abs / scale;
  let frac = (abs % scale).toString().padStart(USDC_DECIMALS, '0').slice(0, max_frac);
  frac = frac.replace(/0+$/, '');
  const whole_str = whole.toLocaleString('en-US');
  const body = frac.length > 0 ? `${whole_str}.${frac}` : whole_str;
  return negative ? `-${body}` : body;
}

/** Parses a user-entered decimal string into base units. Returns null when invalid or over 6 decimals. */
export function parse_usdc(input: string): bigint | null {
  const s = input.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  return BigInt(whole!) * 10n ** BigInt(USDC_DECIMALS) + BigInt((frac + '000000').slice(0, USDC_DECIMALS));
}
