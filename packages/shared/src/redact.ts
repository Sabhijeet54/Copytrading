/**
 * Removes secrets from arbitrary objects before they are logged or stored in
 * audit metadata. Matching is by key name (case/separator-insensitive), recursive.
 *
 * Deliberately NOT matched: `instrumentToken`, `symbolToken` (public market identifiers).
 */
const SENSITIVE_EXACT = new Set([
  'password',
  'passwd',
  'pwd',
  'newpassword',
  'currentpassword',
  'passwordhash',
  'secret',
  'token',
  'tokenhash',
  'authorization',
  'cookie',
  'setcookie',
  'totp',
  'otp',
  'pin',
  'mpin',
  'checksum',
  'credential',
  'credentials',
  'privatekey',
]);

const SENSITIVE_SUFFIXES = [
  'password',
  'secret',
  'accesstoken',
  'refreshtoken',
  'requesttoken',
  'jwttoken',
  'feedtoken',
  'idtoken',
  'sessiontoken',
  'apikey',
  'totpsecret',
  'privatekey',
];

export const REDACTED = '[REDACTED]';

export function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[_\-\s]/g, '');
  return SENSITIVE_EXACT.has(k) || SENSITIVE_SUFFIXES.some((s) => k.endsWith(s));
}

export function redact<T>(value: T, depth = 0): T {
  if (depth > 8 || value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((v) => redact(v, depth + 1)) as unknown as T;
  }
  if (typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveKey(k) ? REDACTED : redact(v, depth + 1);
    }
    return out as T;
  }
  return value;
}

/** Masks all but the last `visible` characters, e.g. a broker client id in UI lists. */
export function mask(value: string | null | undefined, visible = 4): string | null {
  if (!value) return null;
  if (value.length <= visible) return '*'.repeat(value.length);
  return '*'.repeat(value.length - visible) + value.slice(-visible);
}
