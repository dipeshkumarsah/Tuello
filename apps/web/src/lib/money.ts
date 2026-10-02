/** Converts between integer minor units (what the API speaks) and what people type. */

export function fractionDigits(currency: string): number {
  return (
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}

/** "1,234.5" -> 123450 (for 2-digit currencies). Returns null for empty or invalid input. */
export function parseMoney(input: string, currency: string): number | null {
  const cleaned = input.replace(/[^\d.,-]/g, '').replace(/,/g, '');
  if (!cleaned || !/^\d*(\.\d*)?$/.test(cleaned)) return null;
  const digits = fractionDigits(currency);
  const [whole = '0', frac = ''] = cleaned.split('.');
  if (frac.length > digits) return null;
  return (
    Number(whole || '0') * 10 ** digits +
    Number((frac + '0'.repeat(digits)).slice(0, digits) || '0')
  );
}

export function moneyInputValue(minor: number | null | undefined, currency: string): string {
  if (minor == null) return '';
  const digits = fractionDigits(currency);
  return digits === 0 ? String(minor) : (minor / 10 ** digits).toFixed(digits);
}

/** Percent text <-> basis points ("12.5" <-> 1250). */
export function parsePercent(input: string): number | null {
  const t = input.trim();
  if (!t || !/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const bps = Math.round(Number(t) * 100);
  return bps <= 10_000 ? bps : null;
}

export function percentInputValue(bps: number | null | undefined): string {
  return bps == null ? '' : String(bps / 100);
}
