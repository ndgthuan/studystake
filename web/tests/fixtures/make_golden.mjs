// Generates canonical_golden.json by running the ORACLE's canonical_json on the shared fixtures.
// Run from the repo root: node web/tests/fixtures/make_golden.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const oracle_canonical = await import(pathToFileURL(join(here, '..', '..', '..', 'oracle', 'src', 'canonical.ts')).href);
const cases = [
  { name: 'nested_sorted', value: { b: 1, a: { z: [1, 2], y: 'x' } } },
  { name: 'escapes_and_null', value: { n: null, t: true, f: false, s: 'a"b' } },
  { name: 'drops_undefined', value: { a: undefined, b: 1 } },
  { name: 'array_order', value: [3, 1, 2] },
  { name: 'unicode', value: { ten: 'Thuận', mon: 'Vật lý cho CNTT' } },
  { name: 'quiz_attempts_fixture', value: JSON.parse(readFileSync(join(here, 'quiz_attempts.json'), 'utf8')) },
  { name: 'assign_status_fixture', value: JSON.parse(readFileSync(join(here, 'assign_status.json'), 'utf8')) },
];
const out = cases.map((c) => ({ name: c.name, value: c.value, canonical: oracle_canonical.canonical_json(c.value) }));
writeFileSync(join(here, 'canonical_golden.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${out.length} golden cases`);
