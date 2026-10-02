import * as React from 'react';
import { cn } from '../lib/cn';

/**
 * Status without hue: an outline, half-filled, or solid mark plus a text label.
 * outline = not started / pending, half = in progress, solid = done.
 */
export type StatusFill = 'outline' | 'half' | 'solid';

export function StatusMark({ fill, className }: { fill: StatusFill; className?: string }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden
      className={cn('shrink-0', className)}
    >
      <circle
        cx="6"
        cy="6"
        r="5"
        fill={fill === 'solid' ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.5"
      />
      {fill === 'half' ? <path d="M6 1 A5 5 0 0 1 6 11 Z" fill="currentColor" /> : null}
    </svg>
  );
}

export function Status({
  fill,
  label,
  tone,
  className,
}: {
  fill: StatusFill;
  label: React.ReactNode;
  tone?: 'danger';
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-sm',
        tone === 'danger' ? 'text-danger' : 'text-fg',
        className,
      )}
    >
      <StatusMark fill={fill} />
      {label}
    </span>
  );
}

export function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded-sm border border-border-strong px-1.5 text-xs font-medium text-fg',
        className,
      )}
      {...props}
    />
  );
}

export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-border px-1 font-sans text-xs text-fg-muted',
        className,
      )}
      {...props}
    />
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border-strong text-sm font-medium',
        className,
      )}
    >
      {initials || '?'}
    </span>
  );
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-md border border-border bg-bg', className)} {...props} />;
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-md font-semibold">{title}</h2>
        {description ? <p className="text-base text-fg-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
