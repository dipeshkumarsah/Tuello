import * as ToastPrimitive from '@radix-ui/react-toast';
import { AlertCircle, Check, X } from 'lucide-react';
import * as React from 'react';
import { cn } from '../lib/cn';

export interface ToastMessage {
  id: number;
  title: string;
  description?: string;
  tone?: 'default' | 'success' | 'error';
}

type Listener = (toasts: ToastMessage[]) => void;
let items: ToastMessage[] = [];
let seq = 0;
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((l) => l(items));

/** Fire a toast from anywhere (no hook needed). */
export function toast(t: Omit<ToastMessage, 'id'>): void {
  items = [...items, { ...t, id: ++seq }].slice(-3);
  emit();
}

function dismiss(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

/** Mount once near the root. Announces politely to screen readers. */
export function Toaster({ closeLabel = 'Close' }: { closeLabel?: string }) {
  const [list, setList] = React.useState<ToastMessage[]>(items);
  React.useEffect(() => {
    listeners.add(setList);
    return () => {
      listeners.delete(setList);
    };
  }, []);
  return (
    <ToastPrimitive.Provider duration={5000} swipeDirection="right">
      {list.map((t) => (
        <ToastPrimitive.Root
          key={t.id}
          onOpenChange={(open) => !open && dismiss(t.id)}
          className={cn(
            'flex w-full items-start gap-3 rounded-md border bg-bg p-3 pr-10 text-fg animate-in',
            t.tone === 'error' ? 'border-danger' : 'border-border-strong',
          )}
        >
          {t.tone === 'error' ? (
            <AlertCircle size={20} strokeWidth={1.5} className="text-danger" aria-hidden />
          ) : t.tone === 'success' ? (
            <Check size={20} strokeWidth={1.5} aria-hidden />
          ) : null}
          <div className="flex flex-col gap-0.5">
            <ToastPrimitive.Title className="text-base font-medium">{t.title}</ToastPrimitive.Title>
            {t.description ? (
              <ToastPrimitive.Description className="text-sm text-fg-muted">
                {t.description}
              </ToastPrimitive.Description>
            ) : null}
          </div>
          <ToastPrimitive.Close
            aria-label={closeLabel}
            className="absolute top-2.5 right-2.5 rounded-sm p-1 hover:bg-bg-muted"
          >
            <X size={16} strokeWidth={1.5} aria-hidden />
          </ToastPrimitive.Close>
        </ToastPrimitive.Root>
      ))}
      <ToastPrimitive.Viewport className="fixed right-4 bottom-4 z-[100] flex w-[calc(100vw-32px)] max-w-sm flex-col gap-2 outline-none" />
    </ToastPrimitive.Provider>
  );
}
