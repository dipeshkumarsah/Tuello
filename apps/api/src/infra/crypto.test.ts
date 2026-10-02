import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, hashToken, newToken } from './crypto';

describe('crypto', () => {
  const key = randomBytes(32).toString('base64');

  it('encrypts and decrypts', () => {
    const c = encrypt('JBSWY3DPEHPK3PXP', key);
    expect(c).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decrypt(c, key)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('detects tampering', () => {
    const c = encrypt('secret', key);
    const parts = c.split('.');
    parts[2] = Buffer.from('tampered').toString('base64url');
    expect(() => decrypt(parts.join('.'), key)).toThrow();
  });

  it('issues unique tokens and stable hashes', () => {
    const a = newToken();
    expect(a).toHaveLength(43);
    expect(a).not.toBe(newToken());
    expect(hashToken(a)).toBe(hashToken(a));
  });
});
