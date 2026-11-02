import { describe, expect, it } from 'vitest';
import { keccak256, toBytes } from 'viem';
import { canonical_json } from '@/lib/canonical';
import golden from '../fixtures/canonical_golden.json';

describe('canonical_json parity with oracle', () => {
  for (const c of golden as { name: string; value: unknown; canonical: string }[]) {
    it(`matches oracle output for ${c.name}`, () => {
      expect(canonical_json(c.value)).toBe(c.canonical);
    });
  }

  it('sorts keys recursively and removes whitespace', () => {
    expect(canonical_json({ b: 1, a: { z: [1, 2], y: 'x' } })).toBe('{"a":{"y":"x","z":[1,2]},"b":1}');
  });

  it('rejects non-finite numbers and undefined array items', () => {
    expect(() => canonical_json(Number.NaN)).toThrow();
    expect(() => canonical_json([undefined])).toThrow();
  });

  it('drops undefined object fields', () => {
    expect(canonical_json({ a: undefined, b: 1 })).toBe('{"b":1}');
  });

  it('keccak of canonical string is stable across key order', () => {
    const a = keccak256(toBytes(canonical_json({ b: 2, a: 1 })));
    const b = keccak256(toBytes(canonical_json({ a: 1, b: 2 })));
    expect(a).toBe(b);
    expect(a).toBe(keccak256(toBytes('{"a":1,"b":2}')));
  });
});
