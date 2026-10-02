import { expect, test } from '@playwright/test';
import { apexUrl, expectAccessible, linkFromEmail, tenantUrl, unique } from './support';

/**
 * Phase 1 acceptance: sign up, verify email, land on the tenant subdomain, invite a coordinator;
 * the coordinator accepts and logs in.
 */
test('signup → verify → onboarding → invite coordinator → coordinator accepts and signs in', async ({
  page,
  browser,
}) => {
  const slug = unique('e2e');
  const ownerEmail = `owner@${slug}.example.com`;
  const coordEmail = `cora@${slug}.example.com`;
  const password = 'correct horse battery staple';

  // 1. Sign up on the apex.
  await page.goto(apexUrl('/signup'));
  await expect(page.getByRole('heading', { name: 'Create your company account' })).toBeVisible();
  await expectAccessible(page);
  await page.getByLabel('Company name').fill(`${slug} Media`);
  await page.getByLabel('Your address').fill(slug);
  await page.getByLabel('Your name').fill('Olive Owner');
  await page.getByLabel('Work email').fill(ownerEmail);
  await page.getByLabel('Password').fill(password);
  await expect(page.getByText('Available')).toBeVisible();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

  // 2. Verify email: the link points at the tenant subdomain and signs the owner in.
  const verifyLink = await linkFromEmail(ownerEmail, '/verify-email');
  expect(new URL(verifyLink).host).toBe(new URL(tenantUrl(slug, '/')).host);
  await page.goto(verifyLink);

  // 3. Land on the tenant subdomain in the onboarding wizard.
  await expect(page).toHaveURL(tenantUrl(slug, '/onboarding'));
  await expect(page.getByRole('heading', { name: 'Set up your company' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Step 2 of 3')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Step 3 of 3')).toBeVisible();
  await page.getByLabel('Accent colour', { exact: false }).last().fill('#1D3557');
  await expect(page.getByText(/Contrast \d+(\.\d)?:1/)).toBeVisible();
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome, Olive' })).toBeVisible();

  // 4. Invite a coordinator.
  await page.goto(tenantUrl(slug, '/settings/team'));
  await page.getByRole('button', { name: 'Invite' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Email').fill(coordEmail);
  await dialog.getByRole('button', { name: 'Invite' }).click();
  await expect(page.getByText(`Invite sent to ${coordEmail}`, { exact: true })).toBeVisible();
  await expect(page.getByRole('main').getByText(coordEmail, { exact: true })).toBeVisible();

  // 5. The coordinator accepts in a separate browser.
  const inviteLink = await linkFromEmail(coordEmail, '/invite/');
  const coordContext = await browser.newContext();
  const coord = await coordContext.newPage();
  await coord.goto(inviteLink);
  await expect(coord.getByRole('heading', { name: `Join ${slug} Media` })).toBeVisible();
  await expect(coord.getByText('You were invited as Coordinator.')).toBeVisible();
  await expectAccessible(coord);
  await coord.getByLabel('Your name').fill('Cora Coordinator');
  await coord.getByLabel('Password').fill(password);
  await coord.getByRole('button', { name: 'Accept invite' }).click();
  await expect(coord.getByRole('heading', { name: 'Welcome, Cora' })).toBeVisible();

  // 6. ...signs out and logs in again with the new password.
  await coord.getByRole('button', { name: 'Cora Coordinator' }).click();
  await coord.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(coord).toHaveURL(tenantUrl(slug, '/login'));
  await expectAccessible(coord);
  await coord.getByLabel('Email').fill(coordEmail);
  await coord.getByLabel('Password').fill(password);
  await coord.getByRole('button', { name: 'Sign in' }).click();
  await expect(coord.getByRole('heading', { name: 'Welcome, Cora' })).toBeVisible();

  // A coordinator sees the team but cannot invite, and has no settings for domains.
  await coord.goto(tenantUrl(slug, '/settings/team'));
  await expect(coord.getByText('Olive Owner')).toBeVisible();
  await expect(coord.getByRole('button', { name: 'Invite' })).toHaveCount(0);
  await coord.goto(tenantUrl(slug, '/settings/domains'));
  await expect(coord.getByText('You do not have access to this page')).toBeVisible();
  await coordContext.close();
});

test("a session from one tenant is not accepted on another tenant's host", async ({
  page,
  context,
}) => {
  await page.goto(tenantUrl('acme', '/login'));
  await page.getByLabel('Email').fill('owner@acme.test');
  await page.getByLabel('Password').fill(process.env.SEED_PASSWORD ?? 'tuello-demo-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();

  // Copy acme's session cookie onto birch's host, as an attacker would.
  const session = (await context.cookies(tenantUrl('acme', '/'))).find(
    (c) => c.name === 'tuello_session',
  )!;
  await context.addCookies([
    {
      ...session,
      domain: `birch.${new URL(tenantUrl('birch', '/')).hostname.split('.').slice(1).join('.')}`,
    },
  ]);
  await page.goto(tenantUrl('birch', '/'));
  await expect(page).toHaveURL(tenantUrl('birch', '/login'));
});
