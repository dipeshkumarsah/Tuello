import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '../lib/cn';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border font-medium transition-colors duration-100 select-none disabled:pointer-events-none disabled:opacity-50 aria-busy:cursor-progress [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary:
          'border-primary bg-primary text-primary-fg hover:bg-primary-hover hover:border-primary-hover',
        secondary: 'border-border-strong bg-bg text-fg hover:bg-bg-muted',
        ghost: 'border-transparent bg-transparent text-fg hover:bg-bg-muted',
        danger: 'border-danger bg-danger text-danger-fg hover:opacity-90',
        /** Tenant accent on client-facing pages (falls back to primary). */
        accent: 'border-accent bg-accent text-accent-fg hover:opacity-90',
        link: 'border-transparent bg-transparent px-0 text-fg underline underline-offset-4 hover:no-underline',
      },
      size: {
        sm: 'h-7 px-2.5 text-sm',
        md: 'h-9 px-3.5 text-base',
        lg: 'h-11 px-5 text-md',
        icon: 'h-9 w-9 p-0',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Disables the button and marks it busy. The label stays: no spinners. */
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, loading, disabled, type, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : (type ?? 'button')}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={asChild ? undefined : disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';
