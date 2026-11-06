import { describe, expect, it } from 'vitest';
import { format_usdc, parse_usdc } from '@/lib/usdc';
import { explain_error, error_name } from '@/lib/errors';
import { consent_message, demo_submit_message, link_message, metadata_message, unlink_message } from '@/lib/messages';

describe('format_usdc', () => {
  it('formats base units with 6 decimals', () => {
    expect(format_usdc(1_500_000n)).toBe('1.5');
    expect(format_usdc(100_000_000n)).toBe('100');
    expect(format_usdc(0n)).toBe('0');
    expect(format_usdc(1_234_567_890n)).toBe('1,234.56');
  });
  it('respects max fraction digits', () => {
    expect(format_usdc(1_234_567n, 6)).toBe('1.234567');
  });
});

describe('parse_usdc', () => {
  it('parses valid decimal strings', () => {
    expect(parse_usdc('1')).toBe(1_000_000n);
    expect(parse_usdc('0.5')).toBe(500_000n);
    expect(parse_usdc('12.345678')).toBe(12_345_678n);
  });
  it('rejects invalid input', () => {
    expect(parse_usdc('')).toBeNull();
    expect(parse_usdc('-1')).toBeNull();
    expect(parse_usdc('1.0000001')).toBeNull();
    expect(parse_usdc('abc')).toBeNull();
  });
});

describe('explain_error', () => {
  it('maps custom error names to Vietnamese and English', () => {
    expect(explain_error({ errorName: 'TooLate' }, 'vi')).toBe('Đã quá hạn tham gia');
    expect(explain_error({ errorName: 'TooLate' }, 'en')).toBe('Join deadline has passed');
  });
  it('finds custom error names inside nested causes and messages', () => {
    expect(error_name({ cause: { errorName: 'WrongStatus' } })).toBe('WrongStatus');
    expect(error_name(new Error('execution reverted: InvalidProof()'))).toBe('InvalidProof');
  });
  it('maps wallet rejection and insufficient funds', () => {
    expect(explain_error(new Error('User rejected the request.'), 'en')).toBe('You rejected the request');
    expect(explain_error(new Error('insufficient funds for gas'), 'vi')).toBe('Không đủ AVAX để trả phí gas');
  });
  it('falls back to a generic message', () => {
    expect(explain_error(new Error('boom'), 'en')).toBe('Transaction failed. Please try again.');
  });
});

describe('signed message formats (must match oracle)', () => {
  it('link message', () => {
    expect(link_message('0xABCDEF0000000000000000000000000000000001', 'demo', 'demo', 1700000000)).toBe(
      'StudyStake link\nwallet: 0xabcdef0000000000000000000000000000000001\nlms: demo\nsite: demo\nissued_at: 1700000000',
    );
  });
  it('consent message', () => {
    const w = '0x00000000000000000000000000000000000000AA';
    expect(consent_message(w, true, 7)).toBe(`StudyStake credential consent\nwallet: ${w.toLowerCase()}\nshare: true\nissued_at: 7`);
    expect(consent_message(w, false, 7)).toBe(`StudyStake credential consent\nwallet: ${w.toLowerCase()}\nshare: false\nissued_at: 7`);
  });
  it('unlink, demo submit and metadata messages', () => {
    const w = '0x00000000000000000000000000000000000000AA';
    expect(unlink_message(w, 5)).toBe(`StudyStake unlink\nwallet: ${w.toLowerCase()}\nissued_at: 5`);
    expect(demo_submit_message(w, 2, 1, 7)).toBe(
      `StudyStake demo submit\nwallet: ${w.toLowerCase()}\nchallenge: 2\ninstance: 1\nissued_at: 7`,
    );
    expect(metadata_message(w, '0xabc', 9)).toBe(`StudyStake metadata\nwallet: ${w.toLowerCase()}\nhash: 0xabc\nissued_at: 9`);
  });
});
