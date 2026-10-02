import { expect, test } from '@playwright/test';
import { apexUrl, signIn, tenantUrl } from './support';

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

test('signed-in CRM and pricing screens fit 360px', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile-360', 'Only meaningful at 360px.');
  await signIn(page, 'acme', 'coordinator@acme.test');
  for (const path of ['/clients', '/brokerages', '/catalog', '/pricing', '/imports']) {
    await page.goto(tenantUrl('acme', path));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
