import { describe, expect, it } from 'vitest';
import { moneyInputValue, parseMoney, parsePercent, percentInputValue } from './money';

describe('money input', () => {
  it('parses to minor units without floating point surprises', () => {
    expect(parseMoney('175', 'USD')).toBe(17_500);
    expect(parseMoney('1,234.56', 'USD')).toBe(123_456);
    expect(parseMoney('0.1', 'USD')).toBe(10);
    expect(parseMoney('19.99', 'EUR')).toBe(1_999);
    expect(parseMoney('$ 20', 'USD')).toBe(2_000);
    expect(parseMoney('1.234', 'USD')).toBeNull();
    expect(parseMoney('', 'USD')).toBeNull();
    expect(parseMoney('abc', 'USD')).toBeNull();
  });

  it('formats for inputs', () => {
    expect(moneyInputValue(17_500, 'USD')).toBe('175.00');
    expect(moneyInputValue(null, 'USD')).toBe('');
  });

  it('handles percentages as basis points', () => {
    expect(parsePercent('12.5')).toBe(1_250);
    expect(parsePercent('100')).toBe(10_000);
    expect(parsePercent('101')).toBeNull();
    expect(parsePercent('1.234')).toBeNull();
    expect(percentInputValue(725)).toBe('7.25');
  });
});
