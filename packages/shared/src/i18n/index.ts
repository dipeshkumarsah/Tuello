import { en, type MessageKey, type Messages } from './en';

export { en };
export type { MessageKey, Messages };

const catalogues: Record<string, Messages> = { en };

export function getMessages(locale: string): Messages {
  return catalogues[locale] ?? en;
}

export type TranslateVars = Record<string, string | number>;

export function interpolate(template: string, vars?: TranslateVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  );
}

export function createTranslator(locale: string) {
  const messages = getMessages(locale);
  return function t(key: MessageKey | (string & {}), vars?: TranslateVars): string {
    const template = (messages as Record<string, string>)[key] ?? key;
    return interpolate(template, vars);
  };
}

export type Translator = ReturnType<typeof createTranslator>;

export interface FormatSettings {
  locale: string;
  currency: string;
  timeZone: string;
  measurementUnit: 'sqft' | 'm2';
}

/** Money is always integer minor units + ISO currency. */
export function formatMoney(
  minor: number,
  settings: Pick<FormatSettings, 'locale' | 'currency'>,
): string {
  const fmt = new Intl.NumberFormat(settings.locale, {
    style: 'currency',
    currency: settings.currency,
  });
  const digits = fmt.resolvedOptions().maximumFractionDigits ?? 2;
  return fmt.format(minor / 10 ** digits);
}

export function formatDateTime(
  value: string | Date,
  settings: Pick<FormatSettings, 'locale' | 'timeZone'>,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' },
): string {
  return new Intl.DateTimeFormat(settings.locale, {
    ...options,
    timeZone: settings.timeZone,
  }).format(typeof value === 'string' ? new Date(value) : value);
}

export function formatArea(
  value: number,
  settings: Pick<FormatSettings, 'locale' | 'measurementUnit'>,
): string {
  const n = new Intl.NumberFormat(settings.locale, { maximumFractionDigits: 0 }).format(value);
  return settings.measurementUnit === 'm2' ? `${n} m²` : `${n} sq ft`;
}
