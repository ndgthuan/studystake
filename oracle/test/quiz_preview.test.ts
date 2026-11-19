import { describe, expect, it } from 'vitest';
import { fetch_quiz_preview, parse_quiz_url } from '../src/quiz_preview.ts';

const site = 'https://school.example.edu/moodle';
const quiz_url = `${site}/mod/quiz/view.php?id=39`;
const cfg = { moodle_sites: [site] };
const module_response = { cm: { id: 39, course: 6, module: 15, name: 'Chapter 1', modname: 'quiz', instance: 17 }, warnings: [] };
const quiz_item = { id: 17, course: 6, coursemodule: 39, name: 'Chapter 1', timeclose: 1_821_000_000, password: 'private' };

function fixture_calls(...replies: unknown[]) {
  const calls: { url: string; fields: Record<string, string>; redirect: RequestInit['redirect'] }[] = [];
  const fetch_impl: typeof fetch = async (url, init) => {
    const index = calls.length;
    const fields = Object.fromEntries(new URLSearchParams(String(init?.body)));
    calls.push({ url: String(url), fields, redirect: init?.redirect });
    if (index >= replies.length) throw new Error('unexpected Moodle call');
    return Response.json(replies[index]);
  };
  return { calls, fetch_impl, retry_delay_ms: 0 };
}

describe('Moodle quiz preview', () => {
  it('resolves a quiz URL under an exact configured Moodle base and strips unrelated URL parts', () => {
    expect(parse_quiz_url(`${quiz_url}&redirect=1#section`, cfg)).toEqual({ site, lookup: { cmid: 39 } });
    expect(parse_quiz_url(`${site}/mod/quiz/view.php?q=17`, cfg)).toEqual({ site, lookup: { instance_id: 17 } });
    expect(() => parse_quiz_url('https://school.example.edu/mod/quiz/view.php?id=39', cfg)).toThrow('allowlist');
    expect(() => parse_quiz_url('https://school.example.edu.evil.test/moodle/mod/quiz/view.php?id=39', cfg)).toThrow('allowlist');
    expect(() => parse_quiz_url('https://username@school.example.edu/moodle/mod/quiz/view.php?id=39', cfg)).toThrow('one id or q');
    expect(() => parse_quiz_url(`${quiz_url}&id=40`, cfg)).toThrow('one id or q');
    expect(() => parse_quiz_url(`${quiz_url}&q=17`, cfg)).toThrow('one id or q');
    expect(() => parse_quiz_url(`${site}/mod/quiz/view.php?id=9007199254740992`, cfg)).toThrow('one id or q');
  });

  it('resolves the course module to a distinct quiz instance using two read calls on that site', async () => {
    const opts = fixture_calls(module_response, {
      quizzes: [{ ...quiz_item, id: 26, coursemodule: 41 }, quiz_item], warnings: [],
    });
    const preview = await fetch_quiz_preview(site, 'token', { cmid: 39 }, opts);
    expect(preview).toEqual({ site, course_id: 6, instance_id: 17, name: 'Chapter 1', due: 1_821_000_000 });
    expect(opts.calls.map(({ url, redirect }) => ({ url, redirect }))).toEqual([
      { url: `${site}/webservice/rest/server.php`, redirect: 'error' },
      { url: `${site}/webservice/rest/server.php`, redirect: 'error' },
    ]);
    expect(opts.calls[0]!.fields).toMatchObject({ wsfunction: 'core_course_get_course_module', cmid: '39', wstoken: 'token' });
    expect(opts.calls[1]!.fields).toMatchObject({ wsfunction: 'mod_quiz_get_quizzes_by_courses', 'courseids[0]': '6', wstoken: 'token' });
  });

  it('accepts an instance URL through the authorized by-instance lookup', async () => {
    const opts = fixture_calls(module_response, { quizzes: [quiz_item] });
    const preview = await fetch_quiz_preview(site, 'token', { instance_id: 17 }, opts);
    expect(preview).toMatchObject({ course_id: 6, instance_id: 17 });
    expect(opts.calls[0]!.fields).toMatchObject({
      wsfunction: 'core_course_get_course_module_by_instance', module: 'quiz', instance: '17',
    });
  });

  it('returns no deadline if Moodle reports a quiz without a closing time', async () => {
    const { timeclose: _unused, ...no_deadline } = quiz_item;
    for (const quiz of [no_deadline, { ...quiz_item, timeclose: 0 }]) {
      const result = await fetch_quiz_preview(site, 'token', { cmid: 39 }, fixture_calls(module_response, { quizzes: [quiz] }));
      expect(result.due).toBeNull();
    }
  });

  it('rejects other activity types, denied access, and mismatched quiz results', async () => {
    const assign = fixture_calls({ ...module_response, cm: { ...module_response.cm, modname: 'assign' } });
    await expect(fetch_quiz_preview(site, 'token', { cmid: 39 }, assign)).rejects.toMatchObject({ code: 'invalid_quiz_url' });
    expect(assign.calls).toHaveLength(1);
    await expect(fetch_quiz_preview(site, 'token', { cmid: 39 }, fixture_calls({ exception: 'moodle_exception', errorcode: 'accessexception' })))
      .rejects.toMatchObject({ code: 'moodle_access_denied' });
    await expect(fetch_quiz_preview(site, 'token', { cmid: 39 }, fixture_calls(module_response, { quizzes: [{ ...quiz_item, coursemodule: 40 }] })))
      .rejects.toMatchObject({ code: 'moodle_access_denied' });
  });
});
