import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, loginAs, signupTenant, startApp, type Browser, type Harness } from './helpers';

let h: Harness;
let A: Awaited<ReturnType<typeof signupTenant>>;
let B: Awaited<ReturnType<typeof signupTenant>>;
let coord: Browser;

beforeAll(async () => {
  h = await startApp();
  A = await signupTenant(h);
  B = await signupTenant(h);
  coord = await loginAs(h, A.slug, (await addMember(h, A.tenantId, 'coordinator', A.slug)).email);
});
afterAll(async () => {
  await h?.close();
});

async function brokerage(b: Browser, name: string) {
  const r = await b.post('/v1/brokerages', { name, city: 'Austin' });
  expect(r.status).toBe(201);
  return r.body.id as string;
}

async function client(b: Browser, body: Record<string, unknown>) {
  const r = await b.post('/v1/clients', body);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { id: string; displayName: string };
}

describe('clients and brokerages', () => {
  it('a coordinator manages clients with contacts, tags, notes and a timeline', async () => {
    const harbor = await brokerage(coord, 'Harbor Realty Group');
    const tag = (await coord.post('/v1/tags', { name: 'VIP' })).body;
    expect((await coord.post('/v1/tags', { name: 'vip' })).body.id).toBe(tag.id); // idempotent by name
    const c = await client(coord, {
      firstName: 'Maya',
      lastName: 'Chen',
      email: 'Maya.Chen@Harbor.example',
      phone: '(512) 555-0101',
      brokerageId: harbor,
      tagIds: [tag.id],
    });
    const got = (await coord.get(`/v1/clients/${c.id}`)).body;
    expect(got).toMatchObject({
      displayName: 'Maya Chen',
      email: 'maya.chen@harbor.example',
      brokerage: { name: 'Harbor Realty Group' },
      tags: [{ name: 'VIP' }],
    });

    expect(
      (
        await coord.post(`/v1/clients/${c.id}/contacts`, {
          name: 'Sam Assistant',
          role: 'Assistant',
          email: 'sam@harbor.example',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await coord.post(`/v1/clients/${c.id}/notes`, {
          body: 'Prefers morning shoots',
          pinned: true,
        })
      ).status,
    ).toBe(201);
    expect(
      (await coord.patch(`/v1/clients/${c.id}`, { title: 'Broker associate', tagIds: [] })).body,
    ).toMatchObject({ title: 'Broker associate', tags: [] });

    const timeline = (await coord.get(`/v1/clients/${c.id}/timeline`)).body.items.map(
      (a: { type: string }) => a.type,
    );
    expect(timeline).toEqual(['updated', 'note_added', 'contact_added', 'created']);
    expect((await coord.get(`/v1/clients/${c.id}/notes`)).body.items[0]).toMatchObject({
      body: 'Prefers morning shoots',
      pinned: true,
    });
    expect((await coord.get(`/v1/brokerages/${harbor}`)).body.clientCount).toBe(1);
  });

  it('rejects duplicate emails and validates input', async () => {
    await client(coord, { firstName: 'Dup', lastName: 'One', email: 'dup@example.com' });
    const r = await coord.post('/v1/clients', {
      firstName: 'Dup',
      lastName: 'Two',
      email: 'DUP@example.com',
    });
    expect(r.status).toBe(409);
    expect(r.body.errors[0].path).toBe('email');
    expect((await coord.post('/v1/clients', { firstName: '', lastName: '' })).status).toBe(422);
    expect((await coord.post('/v1/clients', { firstName: 'X', phone: '12' })).status).toBe(422);
  });

  it('will not link a client to another tenant’s brokerage', async () => {
    const bBrokerage = await brokerage(B.owner, 'Other Tenant Realty');
    const r = await coord.post('/v1/clients', {
      firstName: 'Cross',
      lastName: 'Link',
      brokerageId: bBrokerage,
    });
    expect(r.status).toBe(422);
  });

  it('cannot delete a brokerage that still has clients', async () => {
    const b = await brokerage(coord, 'Busy Brokers');
    await client(coord, {
      firstName: 'Busy',
      lastName: 'Agent',
      email: 'busy@example.com',
      brokerageId: b,
    });
    expect((await coord.del(`/v1/brokerages/${b}`)).status).toBe(409);
  });
});

describe('search (acceptance)', () => {
  beforeAll(async () => {
    const summit = await brokerage(coord, 'Summit Luxury Properties');
    const keystone = await brokerage(coord, 'Keystone Homes');
    const names = [
      ['Olivia', 'Martinez'],
      ['Liam', 'Johnson'],
      ['Emma', 'Williams'],
      ['Noah', 'Brown'],
      ['Ava', 'Jones'],
      ['Elijah', 'Garcia'],
      ['Sophia', 'Miller'],
      ['James', 'Davis'],
      ['Isabella', 'Rodriguez'],
      ['Lucas', 'Wilson'],
    ];
    for (const [i, [f, l]] of names.entries()) {
      await client(coord, {
        firstName: f,
        lastName: l,
        email: `${f!.toLowerCase()}.${l!.toLowerCase()}@agents.example`,
        phone: `512-555-02${String(i).padStart(2, '0')}`,
        brokerageId: i % 2 ? summit : keystone,
      });
    }
    await client(coord, {
      firstName: 'Priyanka',
      lastName: 'Ramaswamy-Natarajan',
      email: 'pr@boutique.example',
      company: 'Ramaswamy Team',
    });
  });

  const find = async (q: string) =>
    (await coord.get(`/v1/clients?q=${encodeURIComponent(q)}&limit=10`)).body.items as Array<{
      displayName: string;
      email: string;
      brokerage: { name: string } | null;
    }>;

  it('finds by partial first or last name', async () => {
    expect((await find('isab'))[0]!.displayName).toBe('Isabella Rodriguez');
    expect((await find('rodrig'))[0]!.displayName).toBe('Isabella Rodriguez');
    expect((await find('natara'))[0]!.displayName).toBe('Priyanka Ramaswamy-Natarajan');
    expect((await find('olivia mart'))[0]!.displayName).toBe('Olivia Martinez');
  });

  it('finds by partial email', async () => {
    expect((await find('james.dav'))[0]!.email).toBe('james.davis@agents.example');
    expect((await find('pr@boutique'))[0]!.displayName).toBe('Priyanka Ramaswamy-Natarajan');
  });

  it('finds by brokerage name', async () => {
    const r = await find('summit lux');
    expect(r.length).toBe(5);
    expect(r.every((c) => c.brokerage?.name === 'Summit Luxury Properties')).toBe(true);
  });

  it('finds by phone digits and tolerates a typo', async () => {
    expect((await find('555-0207'))[0]!.displayName).toBe('James Davis');
    expect((await find('wiliams'))[0]!.displayName).toBe('Emma Williams');
  });

  it('combines search with filters and never leaks other tenants', async () => {
    const summit = (await coord.get('/v1/brokerages?q=summit')).body.items[0].id;
    const r = (await coord.get(`/v1/clients?q=agents.example&brokerageId=${summit}`)).body.items;
    expect(r.length).toBe(5);
    await client(B.owner, {
      firstName: 'Isabella',
      lastName: 'Rodriguez',
      email: 'isa@tenant-b.example',
    });
    const fromA = await find('isa@tenant-b');
    expect(fromA).toEqual([]);
  });

  it('paginates by name with a stable cursor', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { items: Array<{ id: string; lastName: string }>; nextCursor: string | null } = (
        await coord.get(`/v1/clients?limit=4${cursor ? `&cursor=${cursor}` : ''}`)
      ).body;
      seen.push(...page.items.map((c) => c.id));
      cursor = page.nextCursor;
    } while (cursor);
    const all = (await coord.get('/v1/clients?limit=100')).body.items.map(
      (c: { id: string }) => c.id,
    );
    expect(seen).toEqual(all);
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe('duplicates and merge', () => {
  it('detects duplicates by email, phone and similar name, then merges', async () => {
    const b = await brokerage(coord, 'Merge Realty');
    const keep = await client(coord, {
      firstName: 'Jonathan',
      lastName: 'Whitaker',
      email: 'jon@merge.example',
      brokerageId: b,
    });
    const dupe = await client(coord, {
      firstName: 'Jonathon',
      lastName: 'Whitaker',
      phone: '512 555 0999',
      brokerageId: b,
    });
    await coord.post(`/v1/clients/${dupe.id}/contacts`, { name: 'Assistant Ann' });
    await coord.post(`/v1/clients/${dupe.id}/notes`, { body: 'Gate code changes monthly' });
    const tag = (await coord.post('/v1/tags', { name: 'Luxury' })).body;
    await coord.patch(`/v1/clients/${dupe.id}`, { tagIds: [tag.id] });

    const check = (
      await coord.post('/v1/clients/duplicates/check', {
        firstName: 'Jon',
        lastName: 'Whitaker',
        phone: '+1 512-555-0999',
        brokerageId: b,
      })
    ).body.items;
    expect(check[0].client.id).toBe(dupe.id);
    expect(check[0].reasons).toContain('phone');
    const forKeep = (await coord.get(`/v1/clients/${keep.id}/duplicates`)).body.items;
    expect(forKeep.map((d: { client: { id: string } }) => d.client.id)).toContain(dupe.id);

    const merged = await coord.post(`/v1/clients/${keep.id}/merge`, { sourceId: dupe.id });
    expect(merged.status).toBe(200);
    expect(merged.body).toMatchObject({ phone: '512 555 0999', tags: [{ name: 'Luxury' }] });
    expect(
      (await coord.get(`/v1/clients/${keep.id}/contacts`)).body.items.map(
        (c: { name: string }) => c.name,
      ),
    ).toEqual(['Assistant Ann']);
    expect((await coord.get(`/v1/clients/${keep.id}/notes`)).body.items[0].body).toBe(
      'Gate code changes monthly',
    );
    const timeline = (await coord.get(`/v1/clients/${keep.id}/timeline?limit=50`)).body.items.map(
      (a: { type: string }) => a.type,
    );
    expect(timeline[0]).toBe('merged');
    expect(timeline).toEqual(expect.arrayContaining(['note_added', 'contact_added']));
    const gone = await coord.get(`/v1/clients/${dupe.id}`);
    expect(gone.status).toBe(404);
    expect(gone.body.detail).toContain(keep.id);
    expect((await coord.post(`/v1/clients/${keep.id}/merge`, { sourceId: keep.id })).status).toBe(
      422,
    );
  });
});

describe('saved views', () => {
  it('are private unless shared', async () => {
    const admin = await loginAs(h, A.slug, (await addMember(h, A.tenantId, 'admin', A.slug)).email);
    const mine = await coord.post('/v1/saved-views', {
      entity: 'clients',
      name: 'Archived',
      filters: { status: 'archived', sort: 'name' },
    });
    const shared = await coord.post('/v1/saved-views', {
      entity: 'clients',
      name: 'Team view',
      filters: { sort: 'created' },
      shared: true,
    });
    expect(mine.status).toBe(201);
    const adminSees = (await admin.get('/v1/saved-views?entity=clients')).body.items.map(
      (v: { name: string }) => v.name,
    );
    expect(adminSees).toContain('Team view');
    expect(adminSees).not.toContain('Archived');
    expect((await admin.del(`/v1/saved-views/${shared.body.id}`)).status).toBe(404); // not the owner
    expect((await coord.del(`/v1/saved-views/${mine.body.id}`)).status).toBe(204);
  });
});

describe('tenant isolation through the CRM API', () => {
  it('B cannot read, list, update, merge or delete A records', async () => {
    const c = await client(coord, {
      firstName: 'Private',
      lastName: 'Agent',
      email: 'private@a.example',
    });
    const bk = await brokerage(coord, 'Private Brokerage');
    expect((await B.owner.get(`/v1/clients/${c.id}`)).status).toBe(404);
    expect((await B.owner.patch(`/v1/clients/${c.id}`, { firstName: 'Hacked' })).status).toBe(404);
    expect((await B.owner.del(`/v1/clients/${c.id}`)).status).toBe(404);
    expect((await B.owner.get(`/v1/clients/${c.id}/timeline`)).status).toBe(404);
    expect((await B.owner.post(`/v1/clients/${c.id}/notes`, { body: 'x' })).status).toBe(404);
    expect((await B.owner.get(`/v1/brokerages/${bk}`)).status).toBe(404);
    const bClient = await client(B.owner, {
      firstName: 'Bee',
      lastName: 'Client',
      email: 'bee@b.example',
    });
    expect((await B.owner.post(`/v1/clients/${bClient.id}/merge`, { sourceId: c.id })).status).toBe(
      404,
    );
    expect(
      (await B.owner.get('/v1/clients?limit=100')).body.items.map((x: { id: string }) => x.id),
    ).not.toContain(c.id);
    expect((await coord.get(`/v1/clients/${c.id}`)).body.firstName).toBe('Private');
  });
});
