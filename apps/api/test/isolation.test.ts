import { SESSION_COOKIE } from '@tuello/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  Browser,
  hostFor,
  loginAs,
  signupTenant,
  startApp,
  type Harness,
} from './helpers';

/**
 * Acceptance: a session from tenant A is rejected on tenant B's host, and no API path lets
 * tenant A read, list, update, or delete tenant B's records.
 */
let h: Harness;
let A: Awaited<ReturnType<typeof signupTenant>>;
let B: Awaited<ReturnType<typeof signupTenant>>;

beforeAll(async () => {
  h = await startApp();
  A = await signupTenant(h);
  B = await signupTenant(h);
});
afterAll(async () => {
  await h?.close();
});

describe('host-bound sessions', () => {
  it("rejects tenant A's session cookie on tenant B's host", async () => {
    const stolen = A.owner.cookies.get(SESSION_COOKIE)!;
    expect(stolen).toBeTruthy();
    const onB = new Browser(h.server, hostFor(B.slug));
    onB.cookies.set(SESSION_COOKIE, stolen);
    const res = await onB.get('/v1/me');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('tenant_mismatch');
    // ...and the cookie is cleared there.
    expect(onB.cookies.has(SESSION_COOKIE)).toBe(false);
    // The session still works on its own host.
    expect((await A.owner.get('/v1/me')).status).toBe(200);
  });

  it('rejects it on a host that resolves to no tenant', async () => {
    const ghost = new Browser(h.server, hostFor('no-such-company'));
    ghost.cookies.set(SESSION_COOKIE, A.owner.cookies.get(SESSION_COOKIE)!);
    const res = await ghost.get('/v1/me');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('tenant_not_found');
  });

  it('does not honour a forged session token', async () => {
    const b = new Browser(h.server, hostFor(A.slug));
    b.cookies.set(SESSION_COOKIE, 'forged-token-forged-token-forged-token-1234');
    expect((await b.get('/v1/me')).status).toBe(401);
  });

  it('still rejects after the Valkey copy is lost (database fallback is tenant-scoped too)', async () => {
    const fresh = await loginAs(h, A.slug, A.email);
    await h.redis.flushdb();
    expect((await fresh.get('/v1/me')).status).toBe(200);
    const onB = new Browser(h.server, hostFor(B.slug));
    onB.cookies.set(SESSION_COOKIE, fresh.cookies.get(SESSION_COOKIE)!);
    await h.redis.flushdb();
    expect((await onB.get('/v1/me')).status).toBe(401);
  });
});

describe("tenant A's owner cannot touch tenant B's records through the API", () => {
  it('members: list shows only A; update and delete by B id are 404', async () => {
    const bMember = await addMember(h, B.tenantId, 'coordinator', B.slug);
    const bList = await (await loginAs(h, B.slug, B.email)).get('/v1/members');
    const bMembershipId = bList.body.items.find(
      (m: { userId: string }) => m.userId === bMember.userId,
    ).id;

    const list = await A.owner.get('/v1/members');
    expect(list.body.items.map((m: { email: string }) => m.email)).not.toContain(bMember.email);
    expect((await A.owner.patch(`/v1/members/${bMembershipId}`, { role: 'admin' })).status).toBe(
      404,
    );
    expect((await A.owner.del(`/v1/members/${bMembershipId}`)).status).toBe(404);
    const after = await (await loginAs(h, B.slug, B.email)).get('/v1/members');
    expect(after.body.items.find((m: { id: string }) => m.id === bMembershipId).role).toBe(
      'coordinator',
    );
  });

  it('invites: B invite is invisible and cannot be revoked or accepted on A', async () => {
    const bOwner = await loginAs(h, B.slug, B.email);
    const inv = await bOwner.post('/v1/invites', {
      email: 'iso-invite@example.com',
      role: 'editor',
    });
    expect(inv.status).toBe(201);
    expect(
      (await A.owner.get('/v1/invites')).body.items.map((i: { id: string }) => i.id),
    ).not.toContain(inv.body.id);
    expect((await A.owner.del(`/v1/invites/${inv.body.id}`)).status).toBe(404);
    const { lastEmail, tokenFrom } = await import('./helpers');
    const token = tokenFrom((await lastEmail(h, 'iso-invite@example.com', 'invite')).vars.link!);
    const onA = new Browser(h.server, hostFor(A.slug));
    expect((await onA.get(`/v1/invites/token/${token}`)).body.code).toBe('invalid_token');
  });

  it('domains: B domain is invisible and cannot be verified or deleted from A', async () => {
    const bOwner = await loginAs(h, B.slug, B.email);
    const d = await bOwner.post('/v1/tenant/domains', { hostname: `photos.${B.slug}.example.com` });
    expect(d.status).toBe(201);
    expect((await A.owner.get('/v1/tenant/domains')).body.items).toEqual([]);
    expect((await A.owner.post(`/v1/tenant/domains/${d.body.id}/verify`)).status).toBe(404);
    expect((await A.owner.del(`/v1/tenant/domains/${d.body.id}`)).status).toBe(404);
    // A cannot claim B's hostname either.
    const claim = await A.owner.post('/v1/tenant/domains', {
      hostname: `photos.${B.slug}.example.com`,
    });
    expect(claim.status).toBe(409);
    expect(claim.body.code).toBe('domain_taken');
  });

  it('sessions: A cannot revoke B sessions', async () => {
    const bOwner = await loginAs(h, B.slug, B.email);
    const bSessions = (await bOwner.get('/v1/me/sessions')).body.items;
    for (const s of bSessions)
      expect((await A.owner.del(`/v1/me/sessions/${s.id}`)).status).toBe(404);
    expect((await bOwner.get('/v1/me')).status).toBe(200);
  });

  it('tenant settings and branding are per host', async () => {
    await A.owner.patch('/v1/tenant', { taxLabel: 'GST' });
    await A.owner.patch('/v1/tenant/branding', { accentColor: '#1D3557' });
    const bOwner = await loginAs(h, B.slug, B.email);
    expect((await bOwner.get('/v1/tenant')).body.taxLabel).toBe('Tax');
    expect((await bOwner.get('/v1/tenant/branding')).body.accentColor).toBeNull();
    expect((await A.owner.get('/v1/tenant')).body.slug).toBe(A.slug);
  });

  it('audit log lists only own entries', async () => {
    const res = await A.owner.get('/v1/audit-logs?limit=100');
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    const bOwner = await loginAs(h, B.slug, B.email);
    const bIds = new Set(
      (await bOwner.get('/v1/audit-logs?limit=100')).body.items.map((i: { id: string }) => i.id),
    );
    for (const i of res.body.items) expect(bIds.has(i.id)).toBe(false);
  });

  it('logo keys must belong to the tenant', async () => {
    const res = await A.owner.patch('/v1/tenant/branding', {
      logoKey: `${B.tenantId}/branding/logo.png`,
    });
    expect(res.status).toBe(422);
  });
});
