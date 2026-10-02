import { expect, test } from '@playwright/test';
import { apiCall, expectAccessible, signIn, tenantUrl, unique } from './support';

/**
 * Phase 2 acceptance on the seeded "acme" tenant: create a client, find clients by partial name,
 * email or brokerage, change a size-band price, then edit a price list and see the live quote,
 * which must equal the quote the API computes for the same input.
 */
test('owner manages clients, size-band prices and a price list with a live quote', async ({
  page,
}) => {
  await signIn(page, 'acme', 'owner@acme.test');
  const slug = unique('e2e');

  // Create a client.
  await page.goto(tenantUrl('acme', '/clients'));
  await expect(page.getByRole('heading', { name: 'Clients' })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'New client' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('First name').fill('Quinn');
  await dialog.getByLabel('Last name').fill(`Zephyr${slug}`);
  await dialog.getByLabel('Email').fill(`quinn@${slug}.example.com`);
  await dialog.getByRole('button', { name: 'New client' }).click();
  await expect(page.getByRole('heading', { name: `Quinn Zephyr${slug}` })).toBeVisible();
  await expectAccessible(page);

  // Search by partial name, partial email and brokerage.
  await page.goto(tenantUrl('acme', '/clients'));
  const search = page.getByPlaceholder('Search name, email, phone or brokerage');
  const table = page.getByRole('table');
  await search.fill(`zephyr${slug.slice(0, 6)}`);
  await expect(table.getByText(`Quinn Zephyr${slug}`)).toBeVisible();
  await search.fill('maya.ch');
  await expect(table.getByText('Maya Chen')).toBeVisible();
  await expect(table.getByText('Tom Becker')).toHaveCount(0);
  await search.fill('keyston');
  await expect(table.getByText('Isla Murphy')).toBeVisible();
  await expect(table.getByText('Tom Becker')).toHaveCount(0);

  // Size-band price: 25 photos at 1,500–2,499 sq ft, any type → $180.
  await page.goto(tenantUrl('acme', '/pricing'));
  await page.getByRole('tab', { name: 'Price grid' }).click();
  await page.getByRole('combobox', { name: 'Item' }).click();
  await page.getByRole('option', { name: 'Photography · 25 photos' }).click();
  await page.getByLabel('1,500–2,499 sq ft, Any type').fill('180.00');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible();
  await expectAccessible(page);

  // New price list → editor with live quote (default size 2,000 sq ft), pricing only 25 photos.
  await page.getByRole('tab', { name: 'Price lists' }).click();
  await page.getByLabel('New price list').fill(`VIP ${slug}`);
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByRole('heading', { name: `VIP ${slug}` })).toBeVisible();
  const items = page.getByRole('group', { name: 'Items' });
  for (const box of await items.getByRole('checkbox', { checked: true }).all()) await box.uncheck();
  await items.getByRole('checkbox', { name: 'Photography · 25 photos' }).check();
  const total = page.getByTestId('quote-total');
  await expect(total).toHaveText('$180.00');
  await expectAccessible(page);

  await page.getByRole('combobox', { name: 'Photography · 25 photos, Pricing' }).click();
  await page.getByRole('option', { name: 'Fixed price' }).click();
  await page.getByLabel('Photography · 25 photos, Fixed price').fill('99');
  await expect(total).toHaveText('$99.00');

  await page.getByRole('combobox', { name: 'Photography · 25 photos, Pricing' }).click();
  await page.getByRole('option', { name: '% off' }).click();
  await page.getByLabel('Photography · 25 photos, % off').fill('10');
  await expect(total).toHaveText('$162.00');

  // Add a coupon and a distance-based travel fee in the preview: 10% off, then 50 km mileage.
  await page.getByLabel('Coupon code').fill('welcome10');
  await page.getByLabel('Distance (km)').fill('50');
  // 162.00 − 16.20 = 145.80; travel (50 − 30) km × $1.20 = $24.00.
  await expect(total).toHaveText('$169.80');

  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Photography · 25 photos, % off')).toHaveValue('10');

  // The API prices the same input with the same engine.
  const id = page.url().split('/').pop()!;
  const catalog = await apiCall<{
    variants: Array<{ id: string; name: string; serviceName: string }>;
  }>(page, 'GET', '/v1/pricing/catalog');
  const variant = catalog.body.variants.find(
    (v) => v.serviceName === 'Photography' && v.name === '25 photos',
  )!;
  const quote = await apiCall<{ total: number }>(page, 'POST', '/v1/quotes', {
    priceListId: id,
    property: { size: 2000, distanceKm: 50 },
    items: [{ kind: 'variant', id: variant.id }],
    couponCode: 'WELCOME10',
  });
  expect(quote.status).toBe(200);
  expect(quote.body.total).toBe(16_980);
});

test('a shooter cannot open price lists', async ({ page }) => {
  await signIn(page, 'acme', 'shooter@acme.test');
  await expect(page.getByRole('link', { name: 'Pricing' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Clients' })).toHaveCount(0);
  await page.goto(tenantUrl('acme', '/pricing'));
  await expect(page.getByText('You do not have access to this page')).toBeVisible();
  const res = await apiCall(page, 'GET', '/v1/price-lists');
  expect(res.status).toBe(403);
});
