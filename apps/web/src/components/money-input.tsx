'use client';

import { Input } from '@tuello/ui';
import * as React from 'react';
import { useI18n } from '@/lib/i18n';
import { moneyInputValue, parseMoney, parsePercent, percentInputValue } from '@/lib/money';

type Ids = { id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean };

/** Edits an integer minor-unit amount in the tenant currency. Calls onChange with null if empty or invalid. */
export function MoneyInput({
  value,
  onChange,
  placeholder,
  className,
  ariaLabel,
  ...ids
}: Ids & {
  value: number | null;
  onChange: (minor: number | null) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const { settings } = useI18n();
  const [text, setText] = React.useState(moneyInputValue(value, settings.currency));
  const last = React.useRef(value);
  React.useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(moneyInputValue(value, settings.currency));
    }
  }, [value, settings.currency]);
  const symbol = new Intl.NumberFormat(settings.locale, {
    style: 'currency',
    currency: settings.currency,
    currencyDisplay: 'narrowSymbol',
  })
    .formatToParts(0)
    .find((p) => p.type === 'currency')?.value;
  return (
    <div className={`relative ${className ?? ''}`}>
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-muted"
      >
        {symbol}
      </span>
      <Input
        {...ids}
        aria-label={ariaLabel}
        inputMode="decimal"
        className="pl-7 tabular"
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          const minor = parseMoney(e.target.value, settings.currency);
          last.current = minor;
          onChange(minor);
        }}
      />
    </div>
  );
}

/** Edits basis points as a percentage ("12.5" = 1,250 bps). */
export function PercentInput({
  value,
  onChange,
  className,
  ariaLabel,
  ...ids
}: Ids & {
  value: number | null;
  onChange: (bps: number | null) => void;
  className?: string;
  ariaLabel?: string;
}) {
  const [text, setText] = React.useState(percentInputValue(value));
  const last = React.useRef(value);
  React.useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(percentInputValue(value));
    }
  }, [value]);
  return (
    <div className={`relative ${className ?? ''}`}>
      <Input
        {...ids}
        aria-label={ariaLabel}
        inputMode="decimal"
        className="pr-7 tabular"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const bps = parsePercent(e.target.value);
          last.current = bps;
          onChange(bps);
        }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-fg-muted"
      >
        %
      </span>
    </div>
  );
}
