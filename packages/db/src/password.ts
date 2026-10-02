import argon2 from 'argon2';

/** argon2id with OWASP 2024 minimums (19 MiB, t=2, p=1). Shared by api and seed. */
const OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

export function passwordNeedsRehash(hash: string): boolean {
  return argon2.needsRehash(hash, OPTIONS);
}

/** Fixed dummy hash so unknown-email logins spend the same time as real ones. */
let dummy: Promise<string> | null = null;
export async function burnPasswordCheck(plain: string): Promise<void> {
  dummy ??= hashPassword('timing-equaliser-not-a-real-password');
  await verifyPassword(await dummy, plain);
}
