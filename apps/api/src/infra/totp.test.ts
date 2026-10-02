import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, hotp, totp, verifyTotp } from './totp';

// RFC 6238 Appendix B (SHA-1) secret "12345678901234567890".
const SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('totp', () => {
  it('round-trips base32', () => {
    expect(base32Decode(SECRET).toString()).toBe('12345678901234567890');
  });

  it('matches RFC 4226 HOTP vectors', () => {
    expect(hotp(SECRET, 0)).toBe('755224');
    expect(hotp(SECRET, 1)).toBe('287082');
    expect(hotp(SECRET, 9)).toBe('520489');
  });

  it('matches RFC 6238 TOTP vectors (last 6 digits)', () => {
    expect(totp(SECRET, 59_000)).toBe('287082');
    expect(totp(SECRET, 1_111_111_109_000)).toBe('081804');
    expect(totp(SECRET, 1_234_567_890_000)).toBe('005924');
  });

  it('accepts one step of drift and rejects more', () => {
    const now = 1_700_000_000_000;
    expect(verifyTotp(SECRET, totp(SECRET, now - 30_000), now)).not.toBeNull();
    expect(verifyTotp(SECRET, totp(SECRET, now + 30_000), now)).not.toBeNull();
    expect(verifyTotp(SECRET, totp(SECRET, now - 90_000), now)).toBeNull();
    expect(verifyTotp(SECRET, 'abcdef', now)).toBeNull();
  });
});
