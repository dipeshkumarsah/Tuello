import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import * as React from 'react';
import { cn } from '../lib/cn';
import { inputClass } from './field';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  id?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  'aria-label'?: string;
}

export function Select({ id, options, placeholder, className, ...props }: SelectProps) {
  return (
    <SelectPrimitive.Root
      value={props.value}
      defaultValue={props.defaultValue}
      onValueChange={props.onValueChange}
      disabled={props.disabled}
    >
      <SelectPrimitive.Trigger
        id={id}
        aria-describedby={props['aria-describedby']}
        aria-invalid={props['aria-invalid']}
        aria-label={props['aria-label']}
        className={cn(inputClass, 'items-center justify-between gap-2 text-left', className)}
      >
        <SelectPrimitive.Value
          placeholder={<span className="text-fg-subtle">{placeholder}</span>}
        />
        <SelectPrimitive.Icon>
          <ChevronDown size={16} strokeWidth={1.5} aria-hidden />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-border bg-bg text-fg animate-in"
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value}
                className="relative flex h-8 cursor-default select-none items-center rounded-sm pr-8 pl-2 text-base outline-none data-[highlighted]:bg-bg-muted data-[disabled]:opacity-50"
              >
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="absolute right-2">
                  <Check size={16} strokeWidth={1.5} aria-hidden />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
