import { expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

export const BASE_DOMAIN = process.env.E2E_BASE_DOMAIN ?? 'tuello.localhost';
export const PORT = process.env.E2E_PORT ?? '3000';
export const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';

export const apexUrl = (path: string) => `http://${BASE_DOMAIN}:${PORT}${path}`;
export const tenantUrl = (slug: string, path: string) =>
  `http://${slug}.${BASE_DOMAIN}:${PORT}${path}`;

interface MailpitSummary {
  ID: string;
  To: Array<{ Address: string }>;
  Subject: string;
  Created: string;
}

/** Waits for the newest email to `to` and returns the first link in its text body. */
export async function linkFromEmail(to: string, contains: string): Promise<string> {
  for (let i = 0; i < 60; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const body = (await res.json()) as { messages: MailpitSummary[] };
    const msg = body.messages[0];
    if (msg) {
      const full = (await (await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`)).json()) as {
        Text: string;
      };
      const link = full.Text.match(/https?:\/\/\S+/g)?.find((l) => l.includes(contains));
      if (link) return link;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No email to ${to} containing ${contains}`);
}

/** WCAG 2.2 AA scan; fails on serious or critical violations. */
export async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(
    blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);
}

export function unique(prefix: string) {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
}
