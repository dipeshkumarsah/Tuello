import { z } from 'zod';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../constants';
import { isReservedSlug, isValidSlug } from '../host';

export const uuidSchema = z.uuid();

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ error: 'validation.email' }));

/** 12+ chars, any characters. Length beats composition rules (NIST 800-63B). */
export const passwordSchema = z
  .string()
  .min(12, { error: 'validation.password_min' })
  .max(256, { error: 'validation.password_max' });

export const personNameSchema = z.string().trim().min(1).max(120);

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine(isValidSlug, { error: 'validation.slug_format' })
  .refine((s) => !isReservedSlug(s), { error: 'validation.slug_reserved' });

export const timeZoneSchema = z.string().refine(
  (tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  },
  { error: 'validation.time_zone' },
);

export const SUPPORTED_CURRENCIES = [
  'USD',
  'CAD',
  'AUD',
  'NZD',
  'GBP',
  'EUR',
  'CHF',
  'SEK',
  'NOK',
  'DKK',
  'ZAR',
  'SGD',
  'AED',
  'INR',
  'MXN',
] as const;
export const currencySchema = z.enum(SUPPORTED_CURRENCIES);

export const MEASUREMENT_UNITS = ['sqft', 'm2'] as const;
export const measurementUnitSchema = z.enum(MEASUREMENT_UNITS);
export type MeasurementUnit = z.infer<typeof measurementUnitSchema>;

export const SUPPORTED_LOCALES = ['en'] as const;
export const localeSchema = z.enum(SUPPORTED_LOCALES);

export const cursorPageQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type CursorPageQuery = z.infer<typeof cursorPageQuerySchema>;

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, { error: 'validation.hex_color' })
  .transform((v) => v.toUpperCase());
