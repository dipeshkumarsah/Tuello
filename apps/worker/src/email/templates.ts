import { createTranslator, type EmailTemplate, type MessageKey } from '@tuello/shared';

export interface Brand {
  companyName: string;
  senderName: string;
  replyTo: string | null;
  logoUrl: string | null;
  /** Button colour; black when the tenant has no accent. */
  accentColor: string | null;
  accentTextColor: string | null;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const KEYS: Record<
  EmailTemplate,
  { subject: MessageKey; heading: MessageKey; body: MessageKey; cta: MessageKey }
> = {
  verify_email: {
    subject: 'email.verify.subject',
    heading: 'email.verify.heading',
    body: 'email.verify.body',
    cta: 'email.verify.cta',
  },
  invite: {
    subject: 'email.invite.subject',
    heading: 'email.invite.heading',
    body: 'email.invite.body',
    cta: 'email.invite.cta',
  },
  reset_password: {
    subject: 'email.reset.subject',
    heading: 'email.reset.heading',
    body: 'email.reset.body',
    cta: 'email.reset.cta',
  },
  magic_link: {
    subject: 'email.magic.subject',
    heading: 'email.magic.heading',
    body: 'email.magic.body',
    cta: 'email.magic.cta',
  },
};

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/**
 * Tenant-branded, monochrome transactional email. Never mentions Tuello: the tenant's name,
 * logo and optional accent colour are the only identity a recipient sees.
 */
export function renderEmail(
  template: EmailTemplate,
  vars: Record<string, string>,
  brand: Brand,
  locale = 'en',
): RenderedEmail {
  const t = createTranslator(locale);
  const k = KEYS[template];
  const all = { company: brand.companyName, ...vars };
  const subject = t(k.subject, all);
  const heading = t(k.heading, all);
  const body = t(k.body, all);
  const cta = t(k.cta, all);
  const link = vars.link ?? '';
  const footer = t('email.footer', all);
  const fallback = t('email.linkFallback');
  const button = brand.accentColor ?? '#000000';
  const buttonText = brand.accentTextColor ?? '#FFFFFF';

  const logo = brand.logoUrl
    ? `<img src="${esc(brand.logoUrl)}" alt="${esc(brand.companyName)}" height="40" style="display:block;height:40px;max-width:200px;border:0">`
    : `<div style="font-size:16px;font-weight:600;color:#000000">${esc(brand.companyName)}</div>`;

  const html = `<!doctype html>
<html lang="${esc(locale)}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#FFFFFF;color:#000000;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFFFFF">
    <tr><td align="center" style="padding:40px 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;border:1px solid #E5E5E5;border-radius:6px">
        <tr><td style="padding:32px 32px 0 32px">${logo}</td></tr>
        <tr><td style="padding:32px 32px 0 32px">
          <h1 style="margin:0 0 16px 0;font-size:24px;line-height:32px;font-weight:600;color:#000000">${esc(heading)}</h1>
          <p style="margin:0 0 24px 0;font-size:16px;line-height:24px;color:#262626">${esc(body)}</p>
          <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:6px;background:${esc(button)}">
            <a href="${esc(link)}" style="display:inline-block;padding:12px 20px;font-size:16px;font-weight:500;color:${esc(buttonText)};text-decoration:none;border-radius:6px">${esc(cta)}</a>
          </td></tr></table>
        </td></tr>
        <tr><td style="padding:24px 32px 32px 32px">
          <p style="margin:0 0 4px 0;font-size:13px;line-height:20px;color:#525252">${esc(fallback)}</p>
          <p style="margin:0;font-size:13px;line-height:20px;word-break:break-all"><a href="${esc(link)}" style="color:#000000">${esc(link)}</a></p>
        </td></tr>
      </table>
      <p style="margin:16px 0 0 0;font-size:12px;line-height:18px;color:#737373">${esc(footer)}</p>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `${heading}\n\n${body}\n\n${cta}: ${link}\n\n--\n${footer}\n`;
  return { subject, html, text };
}
