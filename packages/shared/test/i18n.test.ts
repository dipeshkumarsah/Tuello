import { describe, expect, it } from 'vitest';
import { createTranslator, formatArea, formatMoney } from '../src';

describe('i18n', () => {
  it('interpolates', () => {
    const t = createTranslator('en');
    expect(t('home.welcome', { name: 'Ada' })).toBe('Welcome, Ada');
    expect(t('unknown.key')).toBe('unknown.key');
  });

  it('formats money from minor units', () => {
    expect(formatMoney(12345, { locale: 'en', currency: 'USD' })).toBe('$123.45');
    expect(formatMoney(0, { locale: 'en', currency: 'EUR' })).toBe('€0.00');
  });

  it('formats area by tenant unit', () => {
    expect(formatArea(2400, { locale: 'en', measurementUnit: 'sqft' })).toBe('2,400 sq ft');
    expect(formatArea(220, { locale: 'en', measurementUnit: 'm2' })).toBe('220 m²');
  });
});
