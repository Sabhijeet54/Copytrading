import { createHmac } from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32 → bytes (spaces / lowercase / padding tolerated). */
export function base32Decode(input: string): Buffer {
  const s = input.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of s) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('TOTP secret is not valid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** RFC 6238 TOTP (HMAC-SHA1, 30 s step) — what Google Authenticator / Angel One's "enable TOTP" QR uses. */
export function totp(secretBase32: string, now = Date.now(), digits = 6, stepSec = 30): string {
  const key = base32Decode(secretBase32);
  if (key.length < 10) throw new Error('TOTP secret is too short');
  const counter = Math.floor(now / 1000 / stepSec);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', key).update(msg).digest();
  const off = h[h.length - 1]! & 0x0f;
  const code = (h.readUInt32BE(off) & 0x7fffffff) % 10 ** digits;
  return String(code).padStart(digits, '0');
}

/** Accepts a raw base32 secret or an otpauth:// URI (what the QR code encodes). */
export function extractTotpSecret(input: string): string {
  const t = input.trim();
  if (t.toLowerCase().startsWith('otpauth://')) {
    const secret = new URL(t).searchParams.get('secret');
    if (!secret) throw new Error('otpauth URI has no secret');
    return secret;
  }
  return t;
}
