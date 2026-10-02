'use client';

import {
  createTranslator,
  formatArea,
  formatDateTime,
  formatMoney,
  type FormatSettings,
  type Translator,
} from '@tuello/shared';
import * as React from 'react';

interface I18n {
  t: Translator;
  settings: FormatSettings;
  money: (minor: number) => string;
  dateTime: (value: string | Date, options?: Intl.DateTimeFormatOptions) => string;
  area: (value: number) => string;
}

const DEFAULT: FormatSettings = {
  locale: 'en',
  currency: 'USD',
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  measurementUnit: 'sqft',
};

const I18nContext = React.createContext<I18n | null>(null);

/** All user-facing strings and number/date/unit formats go through here, driven by tenant settings. */
export function I18nProvider({
  settings,
  children,
}: {
  settings?: Partial<FormatSettings>;
  children: React.ReactNode;
}) {
  const merged = { ...DEFAULT, ...settings } as FormatSettings;
  const value = React.useMemo<I18n>(
    () => ({
      t: createTranslator(merged.locale),
      settings: merged,
      money: (minor) => formatMoney(minor, merged),
      dateTime: (v, o) => formatDateTime(v, merged, o),
      area: (v) => formatArea(v, merged),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [merged.locale, merged.currency, merged.timeZone, merged.measurementUnit],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = React.useContext(I18nContext);
  if (!ctx) throw new Error('useI18n outside I18nProvider');
  return ctx;
}

export function useT(): Translator {
  return useI18n().t;
}
