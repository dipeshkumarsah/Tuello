import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { totp } from '../src/infra/totp';
import {
  addMember,
  APEX,
  Browser,
  hostFor,
  lastEmail,
  loginAs,
  PASSWORD,
  signupTenant,
  startApp,
  tokenFrom,
  uniqueSlug,
  waitForEmail,
  type Harness,
} from './helpers';

let h: Harness;
beforeAll(async () => {
  h = await startApp();
});
afterAll(async () => {
  await h?.close();
});

describe('signup and email verification', () => {
  it('creates a tenant and owner, emails a verification link, and signs in on verify', async () => {
    const slug = uniqueSlug('signup');
    const apex = new Browser(h.server, APEX);
    const email = `ada@${slug}.example.com`;
    const res = await apex.post('/v1/auth/signup', {
      companyName: 'Ada Media',
      slug,
      name: 'Ada',
      email,
      password: PASSWORD,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ slug, email, loginUrl: `http://${slug}.tuello.test/login` });

    // Not verified yet: login refused.
    const tenantBrowser = new Browser(h.server, hostFor(slug));
    const early = await tenantBrowser.post('/v1/auth/login', { email, password: PASSWORD });
    expect(early.status).toBe(403);
    expect(early.body.code).toBe('email_not_verified');

    const mail = await waitForEmail(h, email, 'verify_email');
    expect(mail.vars.link).toMatch(
      new RegExp(`^http://${slug}\\.tuello\\.test/verify-email\\?token=`),
    );
    const v = await tenantBrowser.post('/v1/auth/verify-email', {
      token: tokenFrom(mail.vars.link!),
    });
    expect(v.status).toBe(200);
    expect(v.body).toEqual({ status: 'ok' });

    const me = await tenantBrowser.get('/v1/me');
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ email, name: 'Ada', emailVerified: true });
    expect(me.body.membership.role).toBe('owner');
    expect(me.body.tenant).toMatchObject({ slug, name: 'Ada Media', status: 'onboarding' });
    expect(me.body.permissions).toContain('subscription.manage');

    // Token is single use.
    const again = await new Browser(h.server, hostFor(slug)).post('/v1/auth/verify-email', {
      token: tokenFrom(mail.vars.link!),
    });
    expect(again.status).toBe(400);
    expect(again.body.code).toBe('invalid_token');
  });

  it('rejects taken and reserved slugs and duplicate emails', async () => {
    const { slug, email } = await signupTenant(h);
    const apex = new Browser(h.server, APEX);
    const dupSlug = await apex.post('/v1/auth/signup', {
      companyName: 'Xen Media',
      slug,
      name: 'X',
      email: 'x@new.example.com',
      password: PASSWORD,
    });
    expect(dupSlug.status).toBe(409);
    expect(dupSlug.body.code).toBe('slug_taken');
    const dupEmail = await apex.post('/v1/auth/signup', {
      companyName: 'Xen Media',
      slug: uniqueSlug(),
      name: 'X',
      email,
      password: PASSWORD,
    });
    expect(dupEmail.body.code).toBe('email_taken');
    const reserved = await apex.post('/v1/auth/signup', {
      companyName: 'Xen Media',
      slug: 'admin',
      name: 'X',
      email: 'y@new.example.com',
      password: PASSWORD,
    });
    expect(reserved.status).toBe(422);
    expect(reserved.body.errors[0]).toMatchObject({ path: 'slug' });

    const avail = await apex.get(`/v1/auth/slug-availability?slug=${slug}`);
    expect(avail.body).toMatchObject({ available: false, reason: 'taken' });
    const free = await apex.get(`/v1/auth/slug-availability?slug=${uniqueSlug('free')}`);
    expect(free.body.available).toBe(true);
  });

  it('only allows signup on the apex host', async () => {
    const { slug } = await signupTenant(h);
    const res = await new Browser(h.server, hostFor(slug)).post('/v1/auth/signup', {});
    expect(res.status).toBe(404);
  });

  it('validates input and returns RFC 9457 problems', async () => {
    const res = await new Browser(h.server, APEX).post('/v1/auth/signup', {
      slug: 'ok-slug',
      email: 'nope',
      password: 'short',
    });
    expect(res.status).toBe(422);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body).toMatchObject({
      type: expect.stringContaining('validation_failed'),
      status: 422,
      code: 'validation_failed',
    });
    const paths = res.body.errors.map((e: { path: string }) => e.path);
    expect(paths).toEqual(expect.arrayContaining(['companyName', 'name', 'email', 'password']));
    expect(res.body.requestId).toBeTruthy();
  });
});

describe('login and logout', () => {
  it('signs in with a password and out again', async () => {
    const { slug, email } = await signupTenant(h);
    const b = await loginAs(h, slug, email);
    expect((await b.get('/v1/me')).status).toBe(200);
    expect((await b.post('/v1/auth/logout')).status).toBe(204);
    expect((await b.get('/v1/me')).status).toBe(401);
  });

  it('gives the same answer for an unknown email, a wrong password, and a non-member', async () => {
    const a = await signupTenant(h);
    const b = await signupTenant(h);
    const browser = new Browser(h.server, hostFor(a.slug));
    const unknown = await browser.post('/v1/auth/login', {
      email: 'nobody@example.com',
      password: PASSWORD,
    });
    const wrong = await browser.post('/v1/auth/login', {
      email: a.email,
      password: 'wrong password!!',
    });
    const otherTenant = await browser.post('/v1/auth/login', {
      email: b.email,
      password: PASSWORD,
    });
    for (const r of [unknown, wrong, otherTenant]) {
      expect(r.status).toBe(401);
      expect(r.body.code).toBe('invalid_credentials');
    }
  });

  it('sets an httpOnly, SameSite=Lax session cookie', async () => {
    const { slug, email } = await signupTenant(h);
    const b = new Browser(h.server, hostFor(slug));
    const res = await b.post('/v1/auth/login', { email, password: PASSWORD });
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('tuello_session='),
    )!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).not.toMatch(/Domain=/i); // host-only: never shared across tenant subdomains
  });
});

describe('password reset', () => {
  it('resets the password, ends existing sessions, and accepts the new password', async () => {
    const { slug, email, owner } = await signupTenant(h);
    const anon = new Browser(h.server, hostFor(slug));
    expect((await anon.post('/v1/auth/password-reset', { email })).status).toBe(202);
    expect(
      (await anon.post('/v1/auth/password-reset', { email: 'ghost@example.com' })).status,
    ).toBe(202);
    const mail = await waitForEmail(h, email, 'reset_password');
    const res = await anon.post('/v1/auth/password-reset/confirm', {
      token: tokenFrom(mail.vars.link!),
      password: 'a brand new password',
    });
    expect(res.status).toBe(204);
    expect((await owner.get('/v1/me')).status).toBe(401); // old session gone
    expect((await anon.post('/v1/auth/login', { email, password: PASSWORD })).status).toBe(401);
    await loginAs(h, slug, email, 'a brand new password');
  });
});

describe('magic link', () => {
  it('signs a client in with a one-time link', async () => {
    const { slug, tenantId } = await signupTenant(h);
    const client = await addMember(h, tenantId, 'client', slug);
    const b = new Browser(h.server, hostFor(slug));
    expect((await b.post('/v1/auth/magic-link', { email: client.email })).status).toBe(202);
    const mail = await waitForEmail(h, client.email, 'magic_link');
    expect(mail.vars.link).toContain(`http://${slug}.tuello.test/magic?token=`);
    const res = await b.post('/v1/auth/magic-link/consume', { token: tokenFrom(mail.vars.link!) });
    expect(res.body).toEqual({ status: 'ok' });
    const me = await b.get('/v1/me');
    expect(me.body.membership.role).toBe('client');
    const replay = await new Browser(h.server, hostFor(slug)).post('/v1/auth/magic-link/consume', {
      token: tokenFrom(mail.vars.link!),
    });
    expect(replay.body.code).toBe('invalid_token');
  });

  it('a magic link from tenant A does not work on tenant B', async () => {
    const a = await signupTenant(h);
    const b = await signupTenant(h);
    await new Browser(h.server, hostFor(a.slug)).post('/v1/auth/magic-link', { email: a.email });
    const mail = await waitForEmail(h, a.email, 'magic_link');
    const res = await new Browser(h.server, hostFor(b.slug)).post('/v1/auth/magic-link/consume', {
      token: tokenFrom(mail.vars.link!),
    });
    expect(res.body.code).toBe('invalid_token');
  });
});

describe('TOTP two-factor', () => {
  it('enrols, then requires a code at login, and rejects replayed codes', async () => {
    const { slug, email, owner } = await signupTenant(h);
    const setup = await owner.post('/v1/me/totp/setup');
    expect(setup.status).toBe(201);
    expect(setup.body.qrSvg).toContain('<svg');
    const secret = setup.body.secret as string;
    expect((await owner.post('/v1/me/totp/confirm', { code: '000000' })).status).toBe(422);
    expect((await owner.post('/v1/me/totp/confirm', { code: totp(secret) })).status).toBe(204);
    expect((await owner.get('/v1/me')).body.user.twoFactorEnabled).toBe(true);

    const b = new Browser(h.server, hostFor(slug));
    const step1 = await b.post('/v1/auth/login', { email, password: PASSWORD });
    expect(step1.body.status).toBe('mfa_required');
    expect((await b.get('/v1/me')).status).toBe(401);
    const bad = await b.post('/v1/auth/mfa', {
      challengeToken: step1.body.challengeToken,
      code: '123456',
    });
    expect(bad.status).toBe(401);
    const code = totp(secret);
    const ok = await b.post('/v1/auth/mfa', { challengeToken: step1.body.challengeToken, code });
    expect(ok.body).toEqual({ status: 'ok' });
    expect((await b.get('/v1/me')).status).toBe(200);

    // Same code again (new challenge) is refused: one use per code.
    const c = new Browser(h.server, hostFor(slug));
    const s2 = await c.post('/v1/auth/login', { email, password: PASSWORD });
    const replay = await c.post('/v1/auth/mfa', { challengeToken: s2.body.challengeToken, code });
    expect(replay.status).toBe(401);
  });

  it('is not offered to clients', async () => {
    const { slug, tenantId } = await signupTenant(h);
    const client = await addMember(h, tenantId, 'client', slug);
    const b = await loginAs(h, slug, client.email);
    const res = await b.post('/v1/me/totp/setup');
    expect(res.status).toBe(403);
  });
});

describe('sessions', () => {
  it('lists and revokes own sessions; changing password ends others', async () => {
    const { slug, email, owner } = await signupTenant(h);
    const second = await loginAs(h, slug, email);
    const list = await owner.get('/v1/me/sessions');
    expect(list.body.items).toHaveLength(2);
    const other = list.body.items.find((s: { current: boolean }) => !s.current);
    expect((await owner.del(`/v1/me/sessions/${other.id}`)).status).toBe(204);
    expect((await second.get('/v1/me')).status).toBe(401);

    const third = await loginAs(h, slug, email);
    const change = await owner.post('/v1/me/password', {
      currentPassword: PASSWORD,
      newPassword: 'another long password',
    });
    expect(change.status).toBe(204);
    expect((await owner.get('/v1/me')).status).toBe(200); // this device re-issued
    expect((await third.get('/v1/me')).status).toBe(401);
  });
});

describe('verification resend', () => {
  it('works from the apex with the slug', async () => {
    const slug = uniqueSlug('resend');
    const email = `r@${slug}.example.com`;
    const apex = new Browser(h.server, APEX);
    await apex.post('/v1/auth/signup', {
      companyName: 'Rho Media',
      slug,
      name: 'R',
      email,
      password: PASSWORD,
    });
    const first = await waitForEmail(h, email, 'verify_email');
    expect((await apex.post('/v1/auth/verify-email/resend', { email, slug })).status).toBe(202);
    await new Promise((r) => setTimeout(r, 50));
    const second = await lastEmail(h, email, 'verify_email');
    expect(second.vars.link).not.toBe(first.vars.link);
    // The superseded link no longer works.
    const b = new Browser(h.server, hostFor(slug));
    expect(
      (await b.post('/v1/auth/verify-email', { token: tokenFrom(first.vars.link!) })).body.code,
    ).toBe('invalid_token');
    expect(
      (await b.post('/v1/auth/verify-email', { token: tokenFrom(second.vars.link!) })).status,
    ).toBe(200);
  });
});
