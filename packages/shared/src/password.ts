import * as argon2 from 'argon2';

/**
 * Password hashing with argon2id (OWASP recommended parameters:
 * 19 MiB memory, 2 iterations, 1 degree of parallelism).
 */
const OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/** A valid hash used to equalize timing when the user does not exist (prevents user enumeration). */
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword('timing-equalizer-not-a-real-password');
  return dummyHash;
}
