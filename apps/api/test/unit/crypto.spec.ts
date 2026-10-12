import { randomBytes } from 'node:crypto';
import { SecretBox, generateToken, sha256 } from '@ctp/shared';

const key = () => randomBytes(32).toString('base64');

describe('SecretBox (AES-256-GCM broker credential encryption)', () => {
  it('round-trips plaintext and never returns the plaintext in the ciphertext', () => {
    const box = new SecretBox(key());
    const secret = 'kite-access-token-abc123';
    const enc = box.encrypt(secret, 'acct_1');
    expect(enc).not.toContain(secret);
    expect(enc.startsWith('v1:k1:')).toBe(true);
    expect(box.decrypt(enc, 'acct_1')).toBe(secret);
  });

  it('uses a fresh IV for every encryption', () => {
    const box = new SecretBox(key());
    expect(box.encrypt('same')).not.toBe(box.encrypt('same'));
  });

  it('rejects a ciphertext bound to a different account (AAD mismatch)', () => {
    const box = new SecretBox(key());
    const enc = box.encrypt('token', 'acct_1');
    expect(() => box.decrypt(enc, 'acct_2')).toThrow();
  });

  it('detects tampering', () => {
    const box = new SecretBox(key());
    const parts = box.encrypt('token').split(':');
    const data = Buffer.from(parts[4]!, 'base64');
    data[0] = data[0]! ^ 0xff;
    parts[4] = data.toString('base64');
    expect(() => box.decrypt(parts.join(':'))).toThrow();
  });

  it('supports key rotation: old ciphertexts decrypt with the previous key', () => {
    const oldKey = key();
    const oldBox = new SecretBox(oldKey, 'k1');
    const enc = oldBox.encrypt('legacy');
    const rotated = new SecretBox(key(), 'k2', { k1: oldKey });
    expect(rotated.decrypt(enc)).toBe('legacy');
    expect(rotated.encrypt('new').startsWith('v1:k2:')).toBe(true);
  });

  it('refuses keys that are not 32 bytes', () => {
    expect(() => new SecretBox(randomBytes(16).toString('base64'))).toThrow();
  });

  it('generates url-safe random tokens and stable sha256 digests', () => {
    const t = generateToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(generateToken()).not.toBe(t);
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
