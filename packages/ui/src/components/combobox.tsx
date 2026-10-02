import * as Popover from '@radix-ui/react-popover';
import { Command } from 'cmdk';
import { Check, ChevronsUpDown } from 'lucide-react';
import * as React from 'react';
import { cn } from '../lib/cn';
import { inputClass } from './field';
import type { SelectOption } from './select';

export interface ComboboxProps {
  id?: string;
  value: string | null;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

/** Searchable select for long lists (time zones, clients). */
export function Combobox({
  id,
  value,
  onValueChange,
  options,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyText = 'No results.',
  className,
  ...aria
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label={aria['aria-label']}
          aria-describedby={aria['aria-describedby']}
          aria-invalid={aria['aria-invalid']}
          className={cn(inputClass, 'items-center justify-between gap-2 text-left', className)}
        >
          <span className={cn('truncate', !selected && 'text-fg-subtle')}>
            {selected?.label ?? placeholder}
          </span>
          <ChevronsUpDown size={16} strokeWidth={1.5} aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={4}
          align="start"
          className="z-50 w-[var(--radix-popover-trigger-width)] min-w-56 rounded-md border border-border bg-bg p-0 text-fg animate-in"
        >
          <Command>
            <Command.Input
              placeholder={searchPlaceholder}
              className="h-9 w-full border-b border-border bg-transparent px-3 text-base outline-none placeholder:text-fg-subtle"
            />
            <Command.List className="max-h-64 overflow-y-auto p-1">
              <Command.Empty className="px-2 py-3 text-sm text-fg-muted">{emptyText}</Command.Empty>
              {options.map((o) => (
                <Command.Item
                  key={o.value}
                  value={`${o.label} ${o.value}`}
                  onSelect={() => {
                    onValueChange(o.value);
                    setOpen(false);
                  }}
                  className="flex h-8 cursor-default items-center justify-between gap-2 rounded-sm px-2 text-base data-[selected=true]:bg-bg-muted"
                >
                  <span className="truncate">{o.label}</span>
                  {o.value === value ? <Check size={16} strokeWidth={1.5} aria-hidden /> : null}
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
