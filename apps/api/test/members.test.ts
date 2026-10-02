import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  Browser,
  hostFor,
  loginAs,
  PASSWORD,
  signupTenant,
  startApp,
  tokenFrom,
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

describe('invites', () => {
  it('owner invites a coordinator; the coordinator accepts and can sign in (acceptance flow)', async () => {
    const { slug, owner } = await signupTenant(h);
    const email = `coord@${slug}.example.com`;
    const invite = await owner.post('/v1/invites', { email, role: 'coordinator' });
    expect(invite.status).toBe(201);
    expect(invite.body).toMatchObject({ email, role: 'coordinator', status: 'pending' });
    expect((await owner.get('/v1/invites')).body.items).toHaveLength(1);

    const mail = await waitForEmail(h, email, 'invite');
    expect(mail.vars).toMatchObject({ inviter: 'Olive Owner', role: 'Coordinator' });
    const token = tokenFrom(mail.vars.link!);
    expect(mail.vars.link).toBe(`http://${slug}.tuello.test/invite/${token}`);

    const guest = new Browser(h.server, hostFor(slug));
    const preview = await guest.get(`/v1/invites/token/${token}`);
    expect(preview.body).toMatchObject({ email, role: 'coordinator', existingUser: false });

    const weak = await guest.post(`/v1/invites/token/${token}/accept`, {
      name: 'Cora',
      password: 'short',
    });
    expect(weak.status).toBe(422);
    const accept = await guest.post(`/v1/invites/token/${token}/accept`, {
      name: 'Cora',
      password: PASSWORD,
    });
    expect(accept.body).toEqual({ status: 'ok' });
    const me = await guest.get('/v1/me');
    expect(me.body.membership.role).toBe('coordinator');
    expect(me.body.user.emailVerified).toBe(true);

    await guest.post('/v1/auth/logout');
    const again = await loginAs(h, slug, email);
    expect((await again.get('/v1/me')).body.user.name).toBe('Cora');
    expect((await owner.get('/v1/invites')).body.items).toHaveLength(0);
    // Used once.
    expect(
      (
        await new Browser(h.server, hostFor(slug)).post(`/v1/invites/token/${token}/accept`, {
          name: 'X',
          password: PASSWORD,
        })
      ).body.code,
    ).toBe('invalid_token');
  });

  it('an existing user from another company joins with their own password', async () => {
    const a = await signupTenant(h);
    const b = await signupTenant(h);
    await b.owner.post('/v1/invites', { email: a.email, role: 'shooter' });
    const token = tokenFrom((await waitForEmail(h, a.email, 'invite')).vars.link!);
    const guest = new Browser(h.server, hostFor(b.slug));
    expect((await guest.get(`/v1/invites/token/${token}`)).body.existingUser).toBe(true);
    expect(
      (await guest.post(`/v1/invites/token/${token}/accept`, { password: 'not my password' }))
        .status,
    ).toBe(401);
    expect(
      (await guest.post(`/v1/invites/token/${token}/accept`, { password: PASSWORD })).body.status,
    ).toBe('ok');
    expect((await guest.get('/v1/me')).body.membership.role).toBe('shooter');
    // Still owner of their own company.
    expect((await a.owner.get('/v1/me')).body.membership.role).toBe('owner');
  });

  it('revoked invites stop working; re-inviting replaces the pending invite', async () => {
    const { owner } = await signupTenant(h);
    const first = await owner.post('/v1/invites', { email: 'twice@example.com', role: 'editor' });
    const second = await owner.post('/v1/invites', { email: 'twice@example.com', role: 'shooter' });
    const pending = (await owner.get('/v1/invites')).body.items;
    expect(pending.map((i: { id: string }) => i.id)).toEqual([second.body.id]);
    expect((await owner.del(`/v1/invites/${first.body.id}`)).status).toBe(404);
    expect((await owner.del(`/v1/invites/${second.body.id}`)).status).toBe(204);
  });

  it('admins cannot grant owner; coordinators cannot invite at all', async () => {
    const { slug, tenantId } = await signupTenant(h);
    const admin = await loginAs(h, slug, (await addMember(h, tenantId, 'admin', slug)).email);
    expect(
      (await admin.post('/v1/invites', { email: 'o@example.com', role: 'owner' })).status,
    ).toBe(403);
    expect(
      (await admin.post('/v1/invites', { email: 'a@example.com', role: 'admin' })).status,
    ).toBe(201);
    const coord = await loginAs(h, slug, (await addMember(h, tenantId, 'coordinator', slug)).email);
    expect(
      (await coord.post('/v1/invites', { email: 'c@example.com', role: 'client' })).status,
    ).toBe(403);
  });

  it('refuses to invite an existing member', async () => {
    const { slug, owner, tenantId } = await signupTenant(h);
    const m = await addMember(h, tenantId, 'editor', slug);
    const res = await owner.post('/v1/invites', { email: m.email, role: 'editor' });
    expect(res.status).toBe(409);
  });
});

describe('members', () => {
  it('lists with cursor pagination', async () => {
    const { slug, tenantId, owner } = await signupTenant(h);
    for (let i = 0; i < 4; i++) await addMember(h, tenantId, 'shooter', slug);
    const p1 = await owner.get('/v1/members?limit=2');
    expect(p1.body.items).toHaveLength(2);
    expect(p1.body.nextCursor).toBeTruthy();
    const p2 = await owner.get(`/v1/members?limit=2&cursor=${p1.body.nextCursor}`);
    const p3 = await owner.get(`/v1/members?limit=2&cursor=${p2.body.nextCursor}`);
    const all = [...p1.body.items, ...p2.body.items, ...p3.body.items].map(
      (m: { id: string }) => m.id,
    );
    expect(new Set(all).size).toBe(5);
    expect(p3.body.nextCursor).toBeNull();
    expect((await owner.get('/v1/members?limit=101')).status).toBe(422);
    expect((await owner.get('/v1/members?cursor=garbage')).status).toBe(422);
  });

  it('changes roles and removes members, revoking their sessions', async () => {
    const { slug, tenantId, owner } = await signupTenant(h);
    const m = await addMember(h, tenantId, 'shooter', slug);
    const mb = await loginAs(h, slug, m.email);
    const id = (await owner.get('/v1/members')).body.items.find(
      (x: { userId: string }) => x.userId === m.userId,
    ).id;
    expect((await owner.patch(`/v1/members/${id}`, { role: 'editor' })).body.role).toBe('editor');
    expect((await mb.get('/v1/me')).body.membership.role).toBe('editor');
    expect((await owner.del(`/v1/members/${id}`)).status).toBe(204);
    expect((await mb.get('/v1/me')).status).toBe(401);
    expect(await loginAs(h, slug, m.email).catch((e: Error) => e.message)).toMatch(/401/);
  });

  it('protects the last owner and the actor themselves', async () => {
    const { slug, tenantId, owner } = await signupTenant(h);
    const me = (await owner.get('/v1/me')).body;
    expect((await owner.patch(`/v1/members/${me.membership.id}`, { role: 'admin' })).status).toBe(
      403,
    );
    expect((await owner.del(`/v1/members/${me.membership.id}`)).status).toBe(403);
    const admin = await loginAs(h, slug, (await addMember(h, tenantId, 'admin', slug)).email);
    expect((await admin.del(`/v1/members/${me.membership.id}`)).status).toBe(403);
    expect((await admin.patch(`/v1/members/${me.membership.id}`, { role: 'editor' })).status).toBe(
      403,
    );
  });
});
