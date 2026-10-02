import { quote, type PricingCatalog } from '@tuello/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, loginAs, signupTenant, startApp, type Browser, type Harness } from './helpers';

let h: Harness;
let A: Awaited<ReturnType<typeof signupTenant>>;
let owner: Browser;
let coord: Browser;
let shooter: Browser;
let catalog: {
  services: Array<{
    id: string;
    name: string;
    variants: Array<{ id: string; name: string; basePrice: number }>;
  }>;
  packages: Array<{ id: string; name: string }>;
  addOns: Array<{ id: string; name: string }>;
};
let bands: Array<{ id: string; minSize: number }>;
let types: Array<{ id: string; key: string }>;
const v = (service: string, variant: string) =>
  catalog.services.find((s) => s.name === service)!.variants.find((x) => x.name === variant)!;

beforeAll(async () => {
  h = await startApp();
  A = await signupTenant(h);
  owner = A.owner;
  coord = await loginAs(h, A.slug, (await addMember(h, A.tenantId, 'coordinator', A.slug)).email);
  shooter = await loginAs(h, A.slug, (await addMember(h, A.tenantId, 'shooter', A.slug)).email);
  expect((await owner.post('/v1/catalog/starter')).status).toBe(200);
  catalog = (await owner.get('/v1/catalog')).body;
  bands = (await owner.get('/v1/size-bands')).body.items;
  types = (await owner.get('/v1/property-types')).body.items;
});
afterAll(async () => {
  await h?.close();
});

describe('catalog', () => {
  it('starter catalog has the seven example services with duration, skill and deliverable', () => {
    expect(catalog.services.map((s) => s.name)).toEqual([
      'Photography',
      'Video',
      'Drone',
      '3D tour',
      'Floor plan',
      'Twilight',
      'Virtual staging',
    ]);
    const drone = catalog.services.find((s) => s.name === 'Drone') as unknown as {
      durationMinutes: number;
      requiredSkill: { name: string };
      deliverableType: string;
    };
    expect(drone).toMatchObject({
      durationMinutes: 30,
      requiredSkill: { name: 'Drone pilot' },
      deliverableType: 'photos',
    });
    expect(catalog.packages.map((p) => p.name)).toEqual(['Essentials', 'Premium']);
  });

  it('owners edit services, variants, packages and add-ons', async () => {
    const skill = (await owner.post('/v1/skills', { name: 'Stager' })).body;
    const svc = await owner.post('/v1/services', {
      name: 'Detail shots',
      category: 'photo',
      durationMinutes: 20,
      requiredSkillId: skill.id,
      deliverableType: 'photos',
    });
    expect(svc.status).toBe(201);
    const variant = await owner.post(`/v1/services/${svc.body.id}/variants`, {
      name: '10 details',
      basePrice: 4_500,
    });
    expect(variant.body).toMatchObject({ basePrice: 4_500 });
    expect(
      (await owner.patch(`/v1/variants/${variant.body.id}`, { basePrice: 5_000 })).body.basePrice,
    ).toBe(5_000);
    const pkg = await owner.post('/v1/packages', {
      name: 'Detail bundle',
      basePrice: 9_000,
      items: [{ variantId: variant.body.id }, { variantId: v('Photography', '25 photos').id }],
    });
    expect(pkg.body.items).toHaveLength(2);
    expect((await owner.del(`/v1/variants/${variant.body.id}`)).status).toBe(409); // still in a package
    expect(
      (
        await owner.post('/v1/add-ons', {
          name: 'Fireplace on',
          basePrice: 0,
          serviceId: svc.body.id,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await owner.post('/v1/services', {
          name: 'Bad',
          category: 'photo',
          durationMinutes: -1,
          deliverableType: 'photos',
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await owner.post('/v1/services/' + svc.body.id + '/variants', {
          name: 'x',
          basePrice: 10.5,
        })
      ).status,
    ).toBe(422);
    expect((await owner.del(`/v1/skills/${skill.id}`)).status).toBe(409);
  });

  it('coordinators read but cannot change the catalog; shooters cannot read it', async () => {
    expect((await coord.get('/v1/catalog')).status).toBe(200);
    expect(
      (
        await coord.post('/v1/services', {
          name: 'X',
          category: 'photo',
          durationMinutes: 1,
          deliverableType: 'photos',
        })
      ).status,
    ).toBe(403);
    expect((await shooter.get('/v1/catalog')).status).toBe(403);
  });
});

describe('pricing', () => {
  it('rejects overlapping size bands', async () => {
    const r = await owner.post('/v1/size-bands', { name: 'Overlap', minSize: 1000, maxSize: 1600 });
    expect(r.status).toBe(409);
    expect(r.body.detail).toMatch(/overlaps/);
  });

  it('price rules feed quotes, and the API quote equals the shared engine on the same snapshot', async () => {
    const photo = v('Photography', '25 photos');
    const condo = types.find((t) => t.key === 'condo')!;
    const band2 = bands[1]!; // 1,500–2,499 sq ft
    const put = await owner.send('put', '/v1/price-rules', {
      itemKind: 'variant',
      itemId: photo.id,
      rules: [
        { sizeBandId: band2.id, propertyTypeId: null, price: 18_000 },
        { sizeBandId: band2.id, propertyTypeId: condo.id, price: 16_500 },
      ],
    });
    expect(put.status).toBe(200);
    await owner.post('/v1/tax-rates', { name: 'TX sales', rateBps: 825, regionCode: 'US-TX' });
    const twilight = catalog.addOns.find((a) => a.name === '10 extra photos')!;
    const request = {
      property: { size: 2000, propertyTypeId: condo.id, regionCode: 'US-TX-AUS' },
      items: [
        { kind: 'variant', id: photo.id },
        { kind: 'add_on', id: twilight.id, quantity: 2 },
      ],
    };
    const api = await coord.post('/v1/quotes', request);
    expect(api.status).toBe(200);
    expect(
      api.body.lines.map((l: { unitPrice: number; priceSource: string }) => [
        l.unitPrice,
        l.priceSource,
      ]),
    ).toEqual([
      [16_500, 'size_band_property_type'],
      [4_000, 'base'],
    ]);
    expect(api.body).toMatchObject({ subtotal: 24_500, tax: 2_021, total: 26_521 }); // 2,021.25 -> 2,021

    const snapshot: PricingCatalog = (await coord.get('/v1/pricing/catalog')).body;
    const local = quote({
      catalog: snapshot,
      property: request.property,
      items: request.items as never,
      asOf: new Date().toISOString(),
    });
    const { context: _context, ...server } = api.body;
    expect(server).toEqual(local);
  });

  it('client price lists: fixed entries replace size-band prices; brokerage list is the fallback', async () => {
    const photo = v('Photography', '25 photos');
    const video = v('Video', 'Walkthrough video');
    const list = (
      await owner.post('/v1/price-lists', { name: 'Top agents', defaultPercentOffBps: 500 })
    ).body;
    const withEntries = await owner.send('put', `/v1/price-lists/${list.id}/entries`, {
      entries: [
        { itemKind: 'variant', itemId: photo.id, fixedPrice: 12_000, percentOffBps: null },
        { itemKind: 'variant', itemId: video.id, fixedPrice: null, percentOffBps: 2_000 },
      ],
    });
    expect(withEntries.body.entries).toHaveLength(2);
    expect(
      (
        await owner.send('put', `/v1/price-lists/${list.id}/entries`, {
          entries: [{ itemKind: 'variant', itemId: photo.id, fixedPrice: 1, percentOffBps: 1 }],
        })
      ).status,
    ).toBe(422);

    const brokerage = (
      await coord.post('/v1/brokerages', { name: 'Listed Brokerage', priceListId: list.id })
    ).body;
    const client = (
      await coord.post('/v1/clients', {
        firstName: 'Price',
        lastName: 'Listed',
        email: 'pl@example.com',
        brokerageId: brokerage.id,
      })
    ).body;
    const q = await coord.post('/v1/quotes', {
      clientId: client.id,
      property: { size: 6000 },
      items: [
        { kind: 'variant', id: photo.id },
        { kind: 'variant', id: video.id },
        { kind: 'variant', id: v('Drone', '10 aerial photos').id },
      ],
    });
    expect(q.body.context.priceList).toEqual({ id: list.id, name: 'Top agents' });
    expect(
      q.body.lines.map((l: { unitPrice: number; priceSource: string }) => [
        l.unitPrice,
        l.priceSource,
      ]),
    ).toEqual([
      [12_000, 'price_list_fixed'],
      [28_000, 'price_list_percent'],
      [14_250, 'price_list_default_percent'],
    ]);
  });

  it('coupons: limits and expiry are enforced by the engine', async () => {
    const photo = v('Photography', '25 photos');
    expect(
      (await owner.post('/v1/coupons', { code: 'spring10', kind: 'percent', percentOffBps: 1_000 }))
        .body.code,
    ).toBe('SPRING10');
    expect(
      (await owner.post('/v1/coupons', { code: 'SPRING10', kind: 'fixed', amountOff: 100 })).status,
    ).toBe(409);
    await owner.post('/v1/coupons', {
      code: 'OLD',
      kind: 'fixed',
      amountOff: 5_000,
      startsAt: '2020-01-01T00:00:00Z',
      expiresAt: '2021-01-01T00:00:00Z',
    });
    const base = { property: { size: 1000 }, items: [{ kind: 'variant', id: photo.id }] };
    expect(
      (await coord.post('/v1/quotes', { ...base, couponCode: 'spring10' })).body.coupon,
    ).toMatchObject({ status: 'applied', amount: 1_750 }); // base 17,500: the grid above has no band for 1,000 sq ft
    expect(
      (await coord.post('/v1/quotes', { ...base, couponCode: 'OLD' })).body.coupon,
    ).toMatchObject({ status: 'expired', amount: 0 });
    expect(
      (await coord.post('/v1/quotes', { ...base, couponCode: 'NOPE' })).body.coupon,
    ).toMatchObject({ status: 'not_found' });
    expect((await coord.get('/v1/coupons/lookup/spring10')).body).toMatchObject({
      code: 'SPRING10',
      percentOffBps: 1_000,
    });
  });

  it('territories resolve from postal codes; travel rules apply by priority', async () => {
    const north = (
      await owner.post('/v1/territories', { name: 'North', postalPrefixes: ['787', '78701'] })
    ).body;
    await owner.post('/v1/travel-fee-rules', {
      kind: 'territory',
      name: 'North fee',
      territoryId: north.id,
      fee: 2_500,
      priority: 1,
    });
    await owner.post('/v1/travel-fee-rules', {
      kind: 'distance',
      name: 'Mileage',
      freeKm: 20,
      perKm: 100,
      minFee: 1_000,
      maxFee: null,
      priority: 10,
    });
    const item = [{ kind: 'variant', id: v('Floor plan', '2D floor plan').id }];
    const inNorth = await coord.post('/v1/quotes', {
      property: { postalCode: '78702' },
      items: item,
    });
    expect(inNorth.body.travel).toMatchObject({ fee: 2_500, reason: 'territory' });
    expect(inNorth.body.context.territory.name).toBe('North');
    const far = await coord.post('/v1/quotes', {
      property: { postalCode: '90210', distanceKm: 45 },
      items: item,
    });
    expect(far.body.travel).toMatchObject({ fee: 2_500, reason: 'distance' });
  });

  it('catalog changes reach quotes immediately (cache invalidation)', async () => {
    const drone = v('Drone', '10 aerial photos');
    const before = (
      await coord.post('/v1/quotes', { property: {}, items: [{ kind: 'variant', id: drone.id }] })
    ).body.subtotal;
    await owner.patch(`/v1/variants/${drone.id}`, { basePrice: before + 1_000 });
    const after = (
      await coord.post('/v1/quotes', { property: {}, items: [{ kind: 'variant', id: drone.id }] })
    ).body.subtotal;
    expect(after).toBe(before + 1_000);
  });
});

describe('permissions (acceptance)', () => {
  it('a shooter cannot open price lists, coupons, tax rates or quotes', async () => {
    for (const path of [
      '/v1/price-lists',
      '/v1/coupons',
      '/v1/tax-rates',
      '/v1/pricing/catalog',
      '/v1/size-bands',
    ]) {
      const r = await shooter.get(path);
      expect([path, r.status, r.body.code]).toEqual([path, 403, 'forbidden']);
    }
    expect((await shooter.post('/v1/quotes', { property: {}, items: [] })).status).toBe(403);
    const list = (await owner.get('/v1/price-lists')).body.items[0];
    expect((await shooter.get(`/v1/price-lists/${list.id}`)).status).toBe(403);
  });

  it('coordinators read pricing but only owners and admins change it', async () => {
    expect((await coord.get('/v1/price-lists')).status).toBe(200);
    expect((await coord.post('/v1/price-lists', { name: 'Nope' })).status).toBe(403);
    expect(
      (await coord.post('/v1/coupons', { code: 'NOPE10', kind: 'percent', percentOffBps: 1000 }))
        .status,
    ).toBe(403);
  });
});

describe('tenant isolation through the pricing API', () => {
  it('another tenant cannot see or use A’s catalog, price lists or coupons', async () => {
    const B = await signupTenant(h);
    const list = (await owner.get('/v1/price-lists')).body.items[0];
    expect((await B.owner.get(`/v1/price-lists/${list.id}`)).status).toBe(404);
    expect(
      (await B.owner.patch(`/v1/variants/${v('Drone', '10 aerial photos').id}`, { basePrice: 1 }))
        .status,
    ).toBe(404);
    expect((await B.owner.get('/v1/catalog')).body.services).toEqual([]);
    const q = await B.owner.post('/v1/quotes', {
      priceListId: list.id,
      property: {},
      items: [{ kind: 'variant', id: v('Drone', '10 aerial photos').id }],
      couponCode: 'SPRING10',
    });
    expect(q.body).toMatchObject({
      lines: [],
      context: { priceList: null },
      coupon: { status: 'not_found' },
    });
    expect(
      (
        await B.owner.send('put', '/v1/price-rules', {
          itemKind: 'variant',
          itemId: v('Drone', '10 aerial photos').id,
          rules: [],
        })
      ).status,
    ).toBe(422);
  });
});
