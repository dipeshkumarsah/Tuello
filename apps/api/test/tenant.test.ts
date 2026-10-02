import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  APEX,
  Browser,
  hostFor,
  signupTenant,
  startApp,
  tokenFrom,
  uniqueSlug,
  type Harness,
} from './helpers';

let h: Harness;
beforeAll(async () => {
  h = await startApp();
});
afterAll(async () => {
  await h?.close();
});

describe('tenant settings and onboarding', () => {
  it('updates settings and completes onboarding', async () => {
    const { owner } = await signupTenant(h);
    const res = await owner.patch('/v1/tenant', {
      name: 'Renamed Media',
      timeZone: 'Europe/Paris',
      currency: 'EUR',
      measurementUnit: 'm2',
    });
    expect(res.status).toBe(200);
    expect(res.body.tenant).toMatchObject({
      name: 'Renamed Media',
      timeZone: 'Europe/Paris',
      currency: 'EUR',
      measurementUnit: 'm2',
    });
    expect(res.body.handoffUrl).toBeNull();
    expect((await owner.patch('/v1/tenant', { timeZone: 'Mars/Olympus' })).status).toBe(422);
    expect((await owner.patch('/v1/tenant', { currency: 'XXX' })).status).toBe(422);
    const done = await owner.post('/v1/tenant/onboarding/complete');
    expect(done.body).toMatchObject({ status: 'active' });
    expect(done.body.onboardingCompletedAt).toBeTruthy();
  });

  it('changing the slug moves the workspace and hands the session over', async () => {
    const { slug, owner } = await signupTenant(h);
    const next = uniqueSlug('moved');
    const res = await owner.patch('/v1/tenant', { slug: next });
    expect(res.status).toBe(200);
    expect(res.body.handoffUrl).toMatch(
      new RegExp(`^http://${next}\\.tuello\\.test/handoff\\?token=`),
    );
    // Old host no longer resolves.
    expect((await new Browser(h.server, hostFor(slug)).get('/v1/tenant/public')).status).toBe(404);
    const moved = new Browser(h.server, hostFor(next));
    expect(
      (await moved.post('/v1/auth/handoff', { token: tokenFrom(res.body.handoffUrl) })).body,
    ).toEqual({ status: 'ok' });
    expect((await moved.get('/v1/me')).body.tenant.slug).toBe(next);
    // One use only.
    expect(
      (
        await new Browser(h.server, hostFor(next)).post('/v1/auth/handoff', {
          token: tokenFrom(res.body.handoffUrl),
        })
      ).status,
    ).toBe(400);
    // Old slug is now free to signup? No: slugs are never reused while taken by history.
    const avail = await new Browser(h.server, APEX).get(`/v1/auth/slug-availability?slug=${next}`);
    expect(avail.body.available).toBe(false);
  });

  it('serves public branding to anyone on the tenant host', async () => {
    const { slug, owner } = await signupTenant(h);
    await owner.patch('/v1/tenant/branding', { accentColor: '#1d3557', emailSenderName: 'Studio' });
    const pub = await new Browser(h.server, hostFor(slug)).get('/v1/tenant/public');
    expect(pub.body).toMatchObject({
      slug,
      branding: { accentColor: '#1D3557', accentTextColor: '#FFFFFF', logoUrl: null },
    });
    expect(pub.body).not.toHaveProperty('currency');
  });

  it('rejects low-contrast accent colours', async () => {
    const { owner } = await signupTenant(h);
    const res = await owner.patch('/v1/tenant/branding', { accentColor: '#FFF3B0' });
    expect(res.status).toBe(422);
    expect(res.body.errors[0].message).toMatch(/contrast/);
  });

  it('issues a tenant-prefixed presigned logo upload', async () => {
    const { owner, tenantId } = await signupTenant(h);
    const res = await owner.post('/v1/tenant/branding/logo-upload', {
      contentType: 'image/png',
      size: 1000,
    });
    expect(res.status).toBe(200);
    expect(res.body.key).toMatch(new RegExp(`^${tenantId}/branding/logo-.+\\.png$`));
    expect(res.body.fields.Policy).toBeTruthy();
    expect(
      (await owner.post('/v1/tenant/branding/logo-upload', { contentType: 'image/gif', size: 10 }))
        .status,
    ).toBe(422);
    expect(
      (
        await owner.post('/v1/tenant/branding/logo-upload', {
          contentType: 'image/png',
          size: 50_000_000,
        })
      ).status,
    ).toBe(422);
    const saved = await owner.patch('/v1/tenant/branding', { logoKey: res.body.key });
    expect(saved.body.logoUrl).toContain(encodeURIComponent(tenantId).replace(/%2F/g, '/'));
  });
});

describe('custom domains', () => {
  it('adds a domain with DNS instructions and queues a verification job', async () => {
    const { owner, slug } = await signupTenant(h);
    const res = await owner.post('/v1/tenant/domains', { hostname: `Media.${slug}.Example.com` });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      hostname: `media.${slug}.example.com`,
      status: 'pending',
      verificationRecordName: `_tuello-verify.media.${slug}.example.com`,
    });
    expect(res.body.verificationRecordValue).toMatch(/^tuello-verify=[0-9a-f]{32}$/);
    await new Promise((r) => setTimeout(r, 50));
    const jobs = await (
      await import('bullmq')
    ).Queue.prototype.getJobs.call(
      new (await import('bullmq')).Queue('domains', { connection: h.redis }),
      ['waiting', 'delayed'],
    );
    expect(jobs.some((j: { data: { domainId: string } }) => j.data.domainId === res.body.id)).toBe(
      true,
    );
  });

  it('refuses platform hostnames', async () => {
    const { owner } = await signupTenant(h);
    expect((await owner.post('/v1/tenant/domains', { hostname: 'evil.tuello.test' })).status).toBe(
      422,
    );
    expect((await owner.post('/v1/tenant/domains', { hostname: 'not a host' })).status).toBe(422);
  });

  it('TLS ask endpoint allows only known subdomains and verified domains', async () => {
    const { slug, owner, tenantId } = await signupTenant(h);
    const d = await owner.post('/v1/tenant/domains', { hostname: `shots.${slug}.example.com` });
    const ask = (domain: string) =>
      new Browser(h.server, 'internal').get(`/v1/internal/tls/ask?domain=${domain}`);
    expect((await ask(`${slug}.tuello.test`)).status).toBe(200);
    expect((await ask('nobody-here.tuello.test')).status).toBe(404);
    expect((await ask(`shots.${slug}.example.com`)).status).toBe(404); // pending
    await h.db.withTenant({ tenantId }, (tx) =>
      tx.tenantDomain.update({ where: { id: d.body.id }, data: { status: 'verified' } }),
    );
    await h.redis.del(`tenant:domain:shots.${slug}.example.com`);
    expect((await ask(`shots.${slug}.example.com`)).status).toBe(200);
    // ...and the custom domain now serves the tenant.
    const pub = await new Browser(h.server, `shots.${slug}.example.com`).get('/v1/tenant/public');
    expect(pub.body.slug).toBe(slug);
  });
});
