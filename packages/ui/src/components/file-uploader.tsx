import { Upload } from 'lucide-react';
import * as React from 'react';
import { cn } from '../lib/cn';

export interface FileUploaderProps {
  accept?: string;
  maxBytes?: number;
  label: string;
  hint?: string;
  disabled?: boolean;
  /** Uploads the file, reporting progress 0..1. Resolve when done; reject to show an error. */
  upload: (file: File, onProgress: (fraction: number) => void) => Promise<void>;
  onError?: (message: string) => void;
  tooLargeText?: string;
  className?: string;
}

/** Drop zone + keyboard-accessible file picker with a progress bar. Bytes go straight to storage. */
export function FileUploader({
  accept,
  maxBytes,
  label,
  hint,
  disabled,
  upload,
  onError,
  tooLargeText = 'File is too large.',
  className,
}: FileUploaderProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [progress, setProgress] = React.useState<number | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const start = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (maxBytes && file.size > maxBytes) {
      setError(tooLargeText);
      onError?.(tooLargeText);
      return;
    }
    setProgress(0);
    try {
      await upload(file, setProgress);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      onError?.(msg);
    } finally {
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void start(e.dataTransfer.files[0]);
        }}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border-strong px-4 py-6 text-center transition-colors duration-100 hover:bg-bg-subtle focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus',
          dragging && 'bg-bg-muted',
          (disabled || progress !== null) && 'pointer-events-none opacity-60',
        )}
      >
        <Upload size={20} strokeWidth={1.5} aria-hidden />
        <span className="text-base font-medium">{label}</span>
        {hint ? <span className="text-sm text-fg-muted">{hint}</span> : null}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          disabled={disabled || progress !== null}
          className="sr-only"
          onChange={(e) => void start(e.target.files?.[0])}
        />
      </label>
      {progress !== null ? (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          aria-label={label}
          className="h-1 w-full overflow-hidden rounded-full bg-bg-emphasis"
        >
          <div
            className="h-full bg-fg transition-[width] duration-100"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
