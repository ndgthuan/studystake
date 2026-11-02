// Canonical JSON. Byte-identical to oracle/src/canonical.ts (same algorithm, same fixtures in tests/fixtures).
// Used for metadata_hash and evidence_hash, so the output must match the oracle exactly.

export function canonical_json(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('canonical_json: non-finite number');
      return JSON.stringify(value);
    case 'object':
      if (Array.isArray(value)) {
        return '[' + value.map((item) => encode_array_item(item)).join(',') + ']';
      }
      return encode_object(value as Record<string, unknown>);
    default:
      throw new TypeError(`canonical_json: unsupported type ${typeof value}`);
  }
}

function encode_array_item(item: unknown): string {
  if (item === undefined) throw new TypeError('canonical_json: undefined in array');
  return canonical_json(item);
}

function encode_object(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  const parts = keys.map((k) => JSON.stringify(k) + ':' + canonical_json(obj[k]));
  return '{' + parts.join(',') + '}';
}
