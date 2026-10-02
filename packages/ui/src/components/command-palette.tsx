import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import { Command } from 'cmdk';
import type { LucideIcon } from 'lucide-react';
import * as React from 'react';
import { Kbd } from './status';

export interface CommandAction {
  id: string;
  label: string;
  group: string;
  icon?: LucideIcon;
  shortcut?: string;
  keywords?: string[];
  run: () => void;
}

/** Opens on Ctrl+K / Cmd+K. */
export function useCommandPaletteHotkey(setOpen: React.Dispatch<React.SetStateAction<boolean>>) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);
}

export function CommandPalette({
  open,
  onOpenChange,
  actions,
  placeholder = 'Search or jump to…',
  emptyText = 'No results.',
  title = 'Command palette',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: CommandAction[];
  placeholder?: string;
  emptyText?: string;
  title?: string;
}) {
  const groups = [...new Set(actions.map((a) => a.group))];
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay animate-in" />
        <DialogPrimitive.Content className="fixed top-[15vh] left-1/2 z-50 w-[calc(100vw-32px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-md border border-border bg-bg text-fg animate-in">
          <VisuallyHidden.Root>
            <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
          </VisuallyHidden.Root>
          <Command label={title}>
            <Command.Input
              placeholder={placeholder}
              className="h-12 w-full border-b border-border bg-transparent px-4 text-md outline-none placeholder:text-fg-subtle"
            />
            <Command.List className="max-h-80 overflow-y-auto p-2">
              <Command.Empty className="px-2 py-6 text-center text-base text-fg-muted">
                {emptyText}
              </Command.Empty>
              {groups.map((g) => (
                <Command.Group
                  key={g}
                  heading={g}
                  className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-fg-muted"
                >
                  {actions
                    .filter((a) => a.group === g)
                    .map((a) => (
                      <Command.Item
                        key={a.id}
                        value={`${a.label} ${(a.keywords ?? []).join(' ')}`}
                        onSelect={() => {
                          onOpenChange(false);
                          a.run();
                        }}
                        className="flex h-9 cursor-default items-center gap-2 rounded-sm px-2 text-base data-[selected=true]:bg-bg-muted"
                      >
                        {a.icon ? <a.icon size={16} strokeWidth={1.5} aria-hidden /> : null}
                        <span className="flex-1">{a.label}</span>
                        {a.shortcut ? <Kbd>{a.shortcut}</Kbd> : null}
                      </Command.Item>
                    ))}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
