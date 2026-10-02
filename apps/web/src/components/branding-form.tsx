'use client';

import {
  checkAccentContrast,
  LOGO_CONTENT_TYPES,
  LOGO_MAX_BYTES,
  type BrandingDto,
} from '@tuello/shared';
import { Button, Field, FileUploader, Input, toast } from '@tuello/ui';
import * as React from 'react';
import { FormMessage } from '@/components/auth-shell';
import { ApiError, post, uploadPresigned } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useUpdateBranding } from '@/lib/tenant';

/** Logo (direct-to-storage upload), optional accent colour with a live contrast check, email sender. */
export function BrandingForm({
  branding,
  sections = ['logo', 'accent', 'email'],
  submitLabel,
  onSaved,
  disabled,
}: {
  branding: BrandingDto;
  sections?: Array<'logo' | 'accent' | 'email'>;
  submitLabel?: string;
  onSaved?: () => void;
  disabled?: boolean;
}) {
  const t = useT();
  const update = useUpdateBranding();
  const [accent, setAccent] = React.useState(branding.accentColor ?? '');
  const [sender, setSender] = React.useState(branding.emailSenderName ?? '');
  const [replyTo, setReplyTo] = React.useState(branding.emailReplyTo ?? '');
  const [error, setError] = React.useState<string | null>(null);

  const accentValid = /^#[0-9a-fA-F]{6}$/.test(accent);
  const contrast = accentValid ? checkAccentContrast(accent) : null;
  const accentError =
    accent && !accentValid
      ? t('validation.hex_color')
      : contrast && !contrast.ok
        ? t('validation.accent_contrast')
        : undefined;

  const uploadLogo = async (file: File, onProgress: (f: number) => void) => {
    if (!(LOGO_CONTENT_TYPES as readonly string[]).includes(file.type))
      throw new Error(t('branding.logoHint'));
    const target = await post<{ key: string; url: string; fields: Record<string, string> }>(
      '/v1/tenant/branding/logo-upload',
      {
        contentType: file.type,
        size: file.size,
      },
    );
    await uploadPresigned(target, file, onProgress);
    await update.mutateAsync({ logoKey: target.key });
    toast({ title: t('settings.saved'), tone: 'success' });
  };

  return (
    <form
      className="flex flex-col gap-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (accentError) return;
        setError(null);
        const body: Record<string, string | null> = {};
        if (sections.includes('accent')) body.accentColor = accent ? accent.toUpperCase() : null;
        if (sections.includes('email')) {
          body.emailSenderName = sender.trim() || null;
          body.emailReplyTo = replyTo.trim() || null;
        }
        update.mutate(body, {
          onSuccess: () => {
            toast({ title: t('settings.saved'), tone: 'success' });
            onSaved?.();
          },
          onError: (err) =>
            setError(
              err instanceof ApiError
                ? (err.problem.errors?.[0]?.message ?? err.problem.title)
                : String(err),
            ),
        });
      }}
    >
      <fieldset disabled={disabled} className="contents">
        {sections.includes('logo') ? (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{t('branding.logo')}</span>
            {branding.logoUrl ? (
              <div className="flex items-center gap-4 rounded-md border border-border p-3">
                {/* Signed, short-lived URL from private storage. */}
                <img
                  src={branding.logoUrl}
                  alt={t('branding.logo')}
                  className="h-10 max-w-[200px] object-contain"
                />
                {!disabled ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => update.mutate({ logoKey: null })}
                  >
                    {t('branding.removeLogo')}
                  </Button>
                ) : null}
              </div>
            ) : null}
            {!disabled ? (
              <FileUploader
                label={t('branding.uploadLogo')}
                hint={t('branding.logoHint')}
                accept={LOGO_CONTENT_TYPES.join(',')}
                maxBytes={LOGO_MAX_BYTES}
                upload={uploadLogo}
              />
            ) : null}
          </div>
        ) : null}

        {sections.includes('accent') ? (
          <Field
            label={t('branding.accent')}
            hint={t('branding.accentHint')}
            error={accentError}
            optional={t('common.optional')}
          >
            {(ids) => (
              <div className="flex flex-wrap items-center gap-3">
                <input
                  type="color"
                  aria-label={t('branding.accent')}
                  value={accentValid ? accent : '#000000'}
                  onChange={(e) => setAccent(e.target.value.toUpperCase())}
                  className="h-9 w-12 cursor-pointer rounded-md border border-border-strong bg-bg p-1"
                />
                <Input
                  {...ids}
                  value={accent}
                  placeholder="#1D3557"
                  onChange={(e) => setAccent(e.target.value.trim())}
                  className="w-32 font-mono"
                />
                {contrast ? (
                  <span className="flex items-center gap-2 text-sm text-fg-muted tabular">
                    <span
                      className="inline-flex h-8 items-center rounded-md px-3 text-sm font-medium"
                      style={{ background: accent, color: contrast.textColor }}
                    >
                      {t('branding.accentPreview')}
                    </span>
                    {t('branding.contrast', {
                      ratio: Math.max(contrast.onBlack, contrast.onWhite).toFixed(1),
                    })}
                  </span>
                ) : null}
              </div>
            )}
          </Field>
        ) : null}

        {sections.includes('email') ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('branding.senderName')}>
              {(ids) => (
                <Input {...ids} value={sender} onChange={(e) => setSender(e.target.value)} />
              )}
            </Field>
            <Field label={t('branding.replyTo')} optional={t('common.optional')}>
              {(ids) => (
                <Input
                  {...ids}
                  type="email"
                  value={replyTo}
                  onChange={(e) => setReplyTo(e.target.value)}
                />
              )}
            </Field>
          </div>
        ) : null}

        <FormMessage>{error}</FormMessage>
        {!disabled && (sections.includes('accent') || sections.includes('email')) ? (
          <div>
            <Button type="submit" loading={update.isPending} disabled={!!accentError}>
              {submitLabel ?? t('common.save')}
            </Button>
          </div>
        ) : null}
      </fieldset>
    </form>
  );
}
