/**
 * Every cryptographic primitive the hub uses, over Web Crypto: token
 * hashing, secret encryption (AES-GCM), cookie sealing, HMAC signatures
 * for guest links, and random identifiers.
 */
const enc = new TextEncoder();
const dec = new TextDecoder();

export function randomId(bytes = 16): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function newToken(prefix: string): string {
  return `${prefix}_${randomId(24)}`;
}

export async function sha256(text: string): Promise<string> {
  return sha256Bytes(enc.encode(text));
}

export async function sha256Bytes(data: Uint8Array): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>)));
}

export async function hmac(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(text))));
}

export async function hmacVerify(secret: string, text: string, signature: string): Promise<boolean> {
  const expected = await hmac(secret, text);
  return timingSafeEqual(expected, signature);
}

async function aesKey(secret: string, usage: KeyUsage[]): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(secret));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, usage);
}

/** AES-GCM: returns base64url(iv).base64url(ciphertext). */
export async function seal(secret: string, plain: string): Promise<string> {
  const key = await aesKey(secret, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain)));
  return `${base64url(iv)}.${base64url(ct)}`;
}

/** Inverse of seal; returns undefined when the box is malformed or tampered. */
export async function open(secret: string, sealed: string): Promise<string | undefined> {
  const [ivText, ctText, extra] = sealed.split('.');
  if (!ivText || !ctText || extra !== undefined) return undefined;
  try {
    const key = await aesKey(secret, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64url(ivText) }, key, fromBase64url(ctText));
    return dec.decode(plain);
  } catch {
    return undefined;
  }
}

export function timingSafeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

export function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

export function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  const b = Buffer.from(text, 'base64url');
  return new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
}

export function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}
