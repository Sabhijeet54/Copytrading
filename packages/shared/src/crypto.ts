import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce, recommended for GCM
const TAG_LENGTH = 16;
const FORMAT_VERSION = 'v1';

/**
 * AES-256-GCM authenticated encryption for broker access/refresh tokens.
 *
 * Ciphertext format: `v1:<keyId>:<iv b64>:<tag b64>:<ciphertext b64>`
 * The keyId allows key rotation: keep old keys in the keyring for decryption
 * while new values are encrypted with the current key.
 */
export class SecretBox {
  private readonly keys = new Map<string, Buffer>();

  constructor(
    currentKeyBase64: string,
    private readonly currentKeyId = 'k1',
    previousKeys: Record<string, string> = {},
  ) {
    this.keys.set(currentKeyId, SecretBox.decodeKey(currentKeyBase64));
    for (const [id, k] of Object.entries(previousKeys)) {
      if (!this.keys.has(id)) this.keys.set(id, SecretBox.decodeKey(k));
    }
  }

  static decodeKey(base64: string): Buffer {
    const key = Buffer.from(base64, 'base64');
    if (key.length !== 32) {
      throw new Error('Encryption key must be 32 bytes (base64 encoded).');
    }
    return key;
  }

  encrypt(plaintext: string, associatedData?: string): string {
    const key = this.keys.get(this.currentKeyId)!;
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
    if (associatedData) cipher.setAAD(Buffer.from(associatedData, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [FORMAT_VERSION, this.currentKeyId, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
  }

  /**
   * @param associatedData must match the value used at encryption time (e.g. the brokerAccountId),
   *        which binds a ciphertext to its row so it cannot be swapped onto another account.
   */
  decrypt(payload: string, associatedData?: string): string {
    const parts = payload.split(':');
    if (parts.length !== 5 || parts[0] !== FORMAT_VERSION) {
      throw new Error('Unsupported ciphertext format.');
    }
    const [, keyId, ivB64, tagB64, dataB64] = parts as [string, string, string, string, string];
    const key = this.keys.get(keyId);
    if (!key) throw new Error(`Unknown encryption key id "${keyId}".`);
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'), { authTagLength: TAG_LENGTH });
    if (associatedData) decipher.setAAD(Buffer.from(associatedData, 'utf8'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  }
}

/** Cryptographically random URL-safe token (default 32 bytes of entropy). */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** SHA-256 hex digest. Used to store refresh/verification tokens without keeping the raw value. */
export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
