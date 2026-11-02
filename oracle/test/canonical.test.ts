import { describe, expect, it } from 'vitest';
import { keccak256, toBytes } from 'viem';
import { canonical_json } from '../src/canonical.ts';
import { metadata_hash, parse_metadata, verify_metadata } from '../src/metadata.ts';

describe('canonical_json', () => {
  it('sorts object keys recursively and removes whitespace', () => {
    const a = canonical_json({ b: 1, a: { z: [1, 2], y: 'x' } });
    const b = canonical_json({ a: { y: 'x', z: [1, 2] }, b: 1 });
    expect(a).toBe('{"a":{"y":"x","z":[1,2]},"b":1}');
    expect(a).toBe(b);
  });

  it('keeps array order and encodes null, booleans and strings', () => {
    expect(canonical_json([3, 1, 2])).toBe('[3,1,2]');
    expect(canonical_json({ n: null, t: true, f: false, s: 'a"b' })).toBe('{"f":false,"n":null,"s":"a\\"b","t":true}');
  });

  it('rejects non-finite numbers and undefined array items', () => {
    expect(() => canonical_json(Number.NaN)).toThrow();
    expect(() => canonical_json([undefined])).toThrow();
  });

  it('drops undefined object fields', () => {
    expect(canonical_json({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
});

describe('metadata hash', () => {
  const doc = {
    version: 1,
    title: 'CSC10002 quiz',
    lms: 'moodle',
    site: 'https://courses.ctda.hcmus.edu.vn',
    course_id: 1234,
    activities: [{ kind: 'quiz', instance_id: 567, name: 'Quiz 10', due: 1763650800 }],
    min_grade: null,
  } as const;

  it('is independent of key order', () => {
    const reordered = {
      min_grade: null,
      activities: [{ due: 1763650800, name: 'Quiz 10', instance_id: 567, kind: 'quiz' }],
      course_id: 1234,
      site: 'https://courses.ctda.hcmus.edu.vn',
      lms: 'moodle',
      title: 'CSC10002 quiz',
      version: 1,
    };
    expect(metadata_hash(reordered)).toBe(metadata_hash(doc));
  });

  it('equals keccak256 of the canonical string', () => {
    expect(metadata_hash({ b: 2, a: 1 })).toBe(keccak256(toBytes('{"a":1,"b":2}')));
  });

  it('changes when any value changes', () => {
    const changed = { ...doc, title: 'other' };
    expect(metadata_hash(changed)).not.toBe(metadata_hash(doc));
  });

  it('verify_metadata accepts the matching hash and rejects a mismatch', () => {
    const h = metadata_hash(doc);
    expect(verify_metadata(doc, h)).toBe(true);
    expect(verify_metadata(doc, h.toUpperCase().replace('0X', '0x'))).toBe(true);
    expect(verify_metadata({ ...doc, course_id: 1 }, h)).toBe(false);
  });

  it('parse_metadata rejects unknown fields and bad activity kinds', () => {
    expect(() => parse_metadata({ ...doc, extra: 1 })).toThrow();
    expect(() =>
      parse_metadata({ ...doc, activities: [{ kind: 'forum', instance_id: 1, name: 'x', due: 1 }] }),
    ).toThrow();
    expect(parse_metadata(doc).title).toBe('CSC10002 quiz');
  });
});
