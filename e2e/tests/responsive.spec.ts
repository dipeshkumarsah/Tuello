import { expect, test } from '@playwright/test';
import { apexUrl, tenantUrl } from './support';

/** Every screen works at 360 px: no horizontal scrolling on the public pages. */
for (const [name, url] of [
  ['signup', apexUrl('/signup')],
  ['tenant login', tenantUrl('acme', '/login')],
] as const) {
  test(`${name} fits 360px`, async ({ page }) => {
    await page.goto(url);
    await expect(page.getByRole('main')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
