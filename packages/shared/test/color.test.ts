import { describe, expect, it } from 'vitest';
import { checkAccentContrast, contrastRatio } from '../src';
import { accentColorSchema } from '../src/schemas/tenant';

describe('contrast', () => {
  it('computes known ratios', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
  });

  it('accepts strong accents and picks a text colour', () => {
    const navy = checkAccentContrast('#1D3557');
    expect(navy.ok).toBe(true);
    expect(navy.textColor).toBe('#FFFFFF');
  });

  it('rejects pale accents', () => {
    expect(checkAccentContrast('#FFF3B0').ok).toBe(false);
    expect(accentColorSchema.safeParse('#FFF3B0').success).toBe(false);
  });

  it('normalises case and rejects bad formats', () => {
    expect(accentColorSchema.parse('#1d3557')).toBe('#1D3557');
    expect(accentColorSchema.safeParse('red').success).toBe(false);
    expect(accentColorSchema.safeParse('#123').success).toBe(false);
  });
});
