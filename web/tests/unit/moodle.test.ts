import { describe, expect, it } from 'vitest';
import { extract_moodle_token, moodle_quiz_url, moodle_token_bookmarklet, moodle_token_page_url } from '@/lib/moodle';

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

describe('moodle_token_bookmarklet', () => {
  const token = 'fedcba9876543210fedcba9876543210';
  const text = { copied: 'copied', copy_manually: 'copy it', not_found: 'none' };

  async function run(html: string, clipboard_ok = true) {
    const calls: { fetched?: string; clip?: string; alert?: string; prompt?: [string, string] } = {};
    const g = {
      window: { M: { cfg: { wwwroot: 'https://moodle.example/lms/' } } },
      location: { origin: 'https://moodle.example' },
      fetch: async (u: string) => { calls.fetched = u; return { text: async () => html }; },
      navigator: { clipboard: { writeText: async (v: string) => { if (!clipboard_ok) throw new Error('blocked'); calls.clip = v; } } },
      alert: (m: string) => { calls.alert = m; },
      prompt: (m: string, v: string) => { calls.prompt = [m, v]; },
      atob,
    };
    g.window = Object.assign(g.window, g);
    const src = decodeURIComponent(moodle_token_bookmarklet(text).slice('javascript:'.length));
    // Run the exact bookmarklet text with browser globals stubbed.
    await new Function(...Object.keys(g), 'M', `return ${src.replace(/;$/, '')}`)(...Object.values(g), g.window.M);
    return calls;
  }

  it('copies only the token from the launch page', async () => {
    const link = `moodlemobile://token=${btoa(`sig:::${token}:::priv`)}`;
    const calls = await run(`<a id="launchapp" href="${link}">Launch</a>`);
    expect(calls.fetched).toContain('https://moodle.example/lms/admin/tool/mobile/launch.php?service=moodle_mobile_app');
    expect(calls.fetched).toContain('confirmed=1');
    expect(calls).toMatchObject({ clip: token, alert: 'copied' });
  });

  it('falls back to a prompt when the clipboard is blocked', async () => {
    const calls = await run(`moodlemobile://token=${btoa(`sig:::${token}`)}`, false);
    expect(calls.prompt).toEqual(['copy it', token]);
  });

  it('reports a page without a token link', async () => {
    expect((await run('<form id="login"></form>')).alert).toBe('none');
  });
});
