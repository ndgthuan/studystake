import { describe, expect, it } from 'vitest';
import { extract_moodle_token, moodle_quiz_url, moodle_token_page_url } from '@/lib/moodle';

describe('moodle_quiz_url', () => {
  it('retains a Moodle subdirectory and uses the quiz instance ID', () => {
    expect(moodle_quiz_url('https://school.example/lms/', 42)).toBe('https://school.example/lms/mod/quiz/view.php?q=42');
  });

  it('rejects unsafe sites and invalid IDs', () => {
    expect(moodle_quiz_url('javascript:alert(1)', 42)).toBeNull();
    expect(moodle_quiz_url('https://user:pass@school.example', 42)).toBeNull();
    expect(moodle_quiz_url('https://school.example', 0)).toBeNull();
  });
});

describe('extract_moodle_token', () => {
  const token = '0123456789abcdef0123456789abcdef';
  const b64 = (s: string) => btoa(s);

  it('accepts a bare 32-hex token', () => {
    expect(extract_moodle_token(`  ${token} `)).toBe(token);
  });

  it('reads the token from a moodlemobile launch link', () => {
    expect(extract_moodle_token(`moodlemobile://token=${b64(`sig123:::${token}`)}`)).toBe(token);
    expect(extract_moodle_token(`moodlemobile://token=${b64(`sig123:::${token}:::private456`)}`)).toBe(token);
  });

  it('returns null for anything else without throwing', () => {
    expect(extract_moodle_token('')).toBeNull();
    expect(extract_moodle_token('not a token')).toBeNull();
    expect(extract_moodle_token('moodlemobile://token=%%%')).toBeNull();
    expect(extract_moodle_token(`moodlemobile://token=${b64('no separator')}`)).toBeNull();
    expect(extract_moodle_token('moodlemobile://token=@@@')).toBeNull();
  });
});

describe('moodle_token_page_url', () => {
  it('builds the confirmed launch page under the site path', () => {
    const url = new URL(moodle_token_page_url('https://school.example/lms/')!);
    expect(url.pathname).toBe('/lms/admin/tool/mobile/launch.php');
    expect(url.searchParams.get('service')).toBe('moodle_mobile_app');
    expect(url.searchParams.get('confirmed')).toBe('1');
  });

  it('rejects unsafe sites', () => {
    expect(moodle_token_page_url('http://school.example')).toBeNull();
    expect(moodle_token_page_url('nonsense')).toBeNull();
  });
});
