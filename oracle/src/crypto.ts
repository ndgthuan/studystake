// AES-GCM for Moodle tokens. Key is a 32-byte base64 secret (TOKEN_ENC_KEY). Uses Web Crypto, so it runs in Workers and Node.

const IV_BYTES = 12;

function b64_to_bytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytes_to_b64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function import_key(key_b64: string): Promise<CryptoKey> {
  const raw = b64_to_bytes(key_b64);
  if (raw.length !== 32) throw new Error('TOKEN_ENC_KEY must decode to 32 bytes');
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** Returns "iv.ciphertext" as base64url-safe parts joined by '.'. A fresh random IV is used every call. */
export async function encrypt_token(plaintext: string, key_b64: string): Promise<string> {
  const key = await import_key(key_b64);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)));
  return `${bytes_to_b64(iv)}.${bytes_to_b64(ct)}`;
}

export async function decrypt_token(packed: string, key_b64: string): Promise<string> {
  const parts = packed.split('.');
  if (parts.length !== 2) throw new Error('malformed encrypted token');
  const [iv_b64, ct_b64] = parts as [string, string];
  const key = await import_key(key_b64);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64_to_bytes(iv_b64) },
    key,
    b64_to_bytes(ct_b64),
  );
  return new TextDecoder().decode(pt);
}
