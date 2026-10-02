/** WCAG 2.x relative luminance and contrast helpers, used to vet a tenant accent colour. */

const HEX_RE = /^#([0-9a-f]{6})$/i;

export function isHexColor(value: string): boolean {
  return HEX_RE.test(value);
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const m = HEX_RE.exec(hex);
  if (!m) throw new Error(`Not a #rrggbb colour: ${hex}`);
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export const MIN_ACCENT_CONTRAST = 4.5;

/**
 * An accent is used as a button fill with either black or white text, on both light and dark
 * page backgrounds. It passes if some text colour reaches 4.5:1 on it AND it is distinguishable
 * (3:1, the non-text threshold) from at least the light page background.
 */
export function checkAccentContrast(hex: string): {
  ok: boolean;
  onWhite: number;
  onBlack: number;
  textColor: '#000000' | '#FFFFFF';
} {
  const onWhite = contrastRatio(hex, '#FFFFFF');
  const onBlack = contrastRatio(hex, '#000000');
  const textColor = onBlack >= onWhite ? '#000000' : '#FFFFFF';
  const bestText = Math.max(onWhite, onBlack);
  const ok = bestText >= MIN_ACCENT_CONTRAST && onWhite >= 3;
  return { ok, onWhite, onBlack, textColor };
}
