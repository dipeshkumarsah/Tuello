import { AlertTriangle, Lock, type LucideIcon } from 'lucide-react';
import * as React from 'react';
import { cn } from '../lib/cn';

/** Placeholder block shown while content loads. Skeletons, never spinners. */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn('animate-pulse rounded-md bg-bg-emphasis', className)}
      {...props}
    />
  );
}

/** Screen-reader announcement + skeleton rows for a list or table. */
export function SkeletonRows({ rows = 5, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

export interface StateMessageProps {
  icon?: LucideIcon;
  title: React.ReactNode;
  body?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  role?: 'status' | 'alert';
}

/** The shared shape of empty, error and no-permission states. */
export function StateMessage({
  icon: Icon,
  title,
  body,
  action,
  className,
  role,
}: StateMessageProps) {
  return (
    <div
      role={role}
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border px-6 py-12 text-center',
        className,
      )}
    >
      {Icon ? <Icon size={20} strokeWidth={1.5} aria-hidden className="text-fg-muted" /> : null}
      <div className="flex max-w-sm flex-col gap-1">
        <p className="text-md font-medium">{title}</p>
        {body ? <p className="text-base text-fg-muted">{body}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function EmptyState(props: StateMessageProps) {
  return <StateMessage role="status" {...props} />;
}

export function ErrorState(props: Omit<StateMessageProps, 'icon'>) {
  return <StateMessage role="alert" icon={AlertTriangle} {...props} />;
}

export function NoPermissionState(props: Omit<StateMessageProps, 'icon'>) {
  return <StateMessage role="status" icon={Lock} {...props} />;
}
