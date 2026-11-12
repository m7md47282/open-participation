import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** URL-safe random token. 32 bytes = 256 bits of entropy. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Share tokens are stored only as this hash, so a database leak does not leak working links. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmac(key: string, data: string): string {
  return createHmac('sha256', key).update(data).digest('base64url');
}

/** Constant-time string comparison, so signatures cannot be guessed byte by byte. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Compact signed token: base64url(JSON payload) + "." + HMAC-SHA256 signature. */
export function signPayload(payload: object, key: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${hmac(key, body)}`;
}

export function verifyPayload<T>(token: string, key: string): T | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, signature] = parts as [string, string];
  if (!safeEqual(signature, hmac(key, body))) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}
