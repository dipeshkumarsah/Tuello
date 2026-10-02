import { describe, expect, it } from 'vitest';
import type { EmailTemplate } from '@tuello/shared';
import { renderEmail, type Brand } from './templates';

const brand: Brand = {
  companyName: 'Acme <Media>',
  senderName: 'Acme',
  replyTo: null,
  logoUrl: null,
  accentColor: null,
  accentTextColor: null,
};

const ALL: EmailTemplate[] = ['verify_email', 'invite', 'reset_password', 'magic_link'];

describe('email templates', () => {
  it.each(ALL)('%s never shows Tuello branding', (tpl) => {
    const e = renderEmail(
      tpl,
      {
        link: 'https://acme.example.com/x?token=abc',
        name: 'Ada',
        inviter: 'Bo',
        role: 'Editor',
        email: 'a@b.c',
      },
      brand,
    );
    for (const part of [e.subject, e.html, e.text])
      expect(part.toLowerCase()).not.toContain('tuello');
    expect(e.html).toContain('https://acme.example.com/x?token=abc');
    expect(e.text).toContain('https://acme.example.com/x?token=abc');
  });

  it('escapes HTML in tenant-provided values', () => {
    const e = renderEmail('magic_link', { link: 'https://x.test/"><script>' }, brand);
    expect(e.html).not.toContain('<script>');
    expect(e.html).toContain('Acme &lt;Media&gt;');
  });

  it('uses the accent colour and logo when set', () => {
    const e = renderEmail(
      'invite',
      { link: 'https://x.test', inviter: 'Bo', role: 'Editor' },
      {
        ...brand,
        accentColor: '#1D3557',
        accentTextColor: '#FFFFFF',
        logoUrl: 'https://cdn.test/logo.png',
      },
    );
    expect(e.html).toContain('background:#1D3557');
    expect(e.html).toContain('src="https://cdn.test/logo.png"');
    expect(e.subject).toBe('Bo invited you to Acme <Media>');
  });
});
