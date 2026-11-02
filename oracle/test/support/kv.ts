// In-memory KV shim matching the KvLike surface used by the oracle. Also used by the E2E script.
import type { KvLike } from '../../src/lms/demo.ts';

export function make_memory_kv(): KvLike & { _dump(): Map<string, string> } {
  const data = new Map<string, string>();
  return {
    async get(key) {
      return data.has(key) ? data.get(key)! : null;
    },
    async put(key, value) {
      data.set(key, value);
    },
    async delete(key) {
      data.delete(key);
    },
    _dump() {
      return data;
    },
  };
}
