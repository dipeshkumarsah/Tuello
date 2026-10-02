/** Integer money helpers. Never use floating point for an amount that is stored or charged. */

export class PricingInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PricingInputError';
  }
}

export function assertMoney(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new PricingInputError(`${what} must be a non-negative integer (minor units), got ${value}`);
}

export function assertBps(value: number, what: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 10_000) throw new PricingInputError(`${what} must be 0..10000 basis points, got ${value}`);
}

/** amount * bps / 10000, rounded half up (amount >= 0). */
export function percentOf(amount: number, bps: number): number {
  return Math.floor((amount * bps + 5_000) / 10_000);
}

/** amount reduced by bps percent, rounded half up. */
export function percentOff(amount: number, bps: number): number {
  return amount - percentOf(amount, bps);
}

/**
 * Splits `total` across `weights` proportionally using the largest-remainder method, so the parts
 * are integers that sum exactly to `total`. Ties go to the earlier weight.
 */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0 || total === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const parts = raw.map(Math.floor);
  let rest = total - parts.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (rest <= 0) break;
    parts[i]! += 1;
    rest -= 1;
  }
  return parts;
}

export const SQM_TO_SQFT = 10.763910417;

export function convertSize(size: number, from: 'sqft' | 'm2', to: 'sqft' | 'm2'): number {
  if (from === to) return size;
  return from === 'm2' ? size * SQM_TO_SQFT : size / SQM_TO_SQFT;
}
