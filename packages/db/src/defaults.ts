import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;
type Unit = 'sqft' | 'm2';

export const DEFAULT_PROPERTY_TYPES = [
  { key: 'house', name: 'House' },
  { key: 'condo', name: 'Condo / apartment' },
  { key: 'townhouse', name: 'Townhouse' },
  { key: 'multi_family', name: 'Multi-family' },
  { key: 'land', name: 'Land' },
  { key: 'commercial', name: 'Commercial' },
];

const BANDS: Record<Unit, Array<[string, number, number | null]>> = {
  sqft: [
    ['Under 1,500 sq ft', 0, 1500],
    ['1,500–2,499 sq ft', 1500, 2500],
    ['2,500–3,499 sq ft', 2500, 3500],
    ['3,500–4,999 sq ft', 3500, 5000],
    ['5,000+ sq ft', 5000, null],
  ],
  m2: [
    ['Under 140 m²', 0, 140],
    ['140–229 m²', 140, 230],
    ['230–324 m²', 230, 325],
    ['325–464 m²', 325, 465],
    ['465+ m²', 465, null],
  ],
};

/** Property types and size bands every tenant starts with. Idempotent; run in a tenant transaction. */
export async function ensureTenantDefaults(tx: Tx, tenantId: string, unit: Unit): Promise<void> {
  if ((await tx.propertyType.count({ where: { deletedAt: null } })) === 0) {
    await tx.propertyType.createMany({
      data: DEFAULT_PROPERTY_TYPES.map((p, i) => ({
        tenantId,
        key: p.key,
        name: p.name,
        sortOrder: i,
      })),
    });
  }
  if ((await tx.sizeBand.count({ where: { deletedAt: null } })) === 0) {
    await tx.sizeBand.createMany({
      data: BANDS[unit].map(([name, minSize, maxSize]) => ({ tenantId, name, minSize, maxSize })),
    });
  }
}

/**
 * Example catalog (photo, video, drone, 3D tour, floor plan, twilight, virtual staging) with
 * size-band prices for photography. Offered to new tenants as a starting point; skipped if the
 * tenant already has services. Prices are minor units of the tenant currency.
 */
export async function seedStarterCatalog(tx: Tx, tenantId: string, unit: Unit): Promise<boolean> {
  if ((await tx.service.count({ where: { deletedAt: null } })) > 0) return false;
  await ensureTenantDefaults(tx, tenantId, unit);

  const skill = async (name: string) =>
    (await tx.skill.findFirst({ where: { name, deletedAt: null } })) ??
    (await tx.skill.create({ data: { tenantId, name } }));
  const photographer = await skill('Photographer');
  const videographer = await skill('Videographer');
  const pilot = await skill('Drone pilot');
  const tourTech = await skill('3D tour capture');

  const defs = [
    {
      name: 'Photography',
      category: 'photo',
      minutes: 60,
      skill: photographer.id,
      deliverable: 'photos',
      variants: [
        ['25 photos', 17_500],
        ['40 photos', 22_500],
      ],
    },
    {
      name: 'Video',
      category: 'video',
      minutes: 90,
      skill: videographer.id,
      deliverable: 'video',
      variants: [['Walkthrough video', 35_000]],
    },
    {
      name: 'Drone',
      category: 'drone',
      minutes: 30,
      skill: pilot.id,
      deliverable: 'photos',
      variants: [['10 aerial photos', 15_000]],
    },
    {
      name: '3D tour',
      category: 'tour_3d',
      minutes: 60,
      skill: tourTech.id,
      deliverable: 'tour',
      variants: [['Interactive 3D tour', 25_000]],
    },
    {
      name: 'Floor plan',
      category: 'floor_plan',
      minutes: 30,
      skill: tourTech.id,
      deliverable: 'floor_plan',
      variants: [['2D floor plan', 10_000]],
    },
    {
      name: 'Twilight',
      category: 'twilight',
      minutes: 60,
      skill: photographer.id,
      deliverable: 'photos',
      variants: [['Twilight shoot', 20_000]],
    },
    {
      name: 'Virtual staging',
      category: 'virtual_staging',
      minutes: 0,
      skill: null,
      deliverable: 'photos',
      variants: [['Per room', 3_500]],
    },
  ] as const;

  const variants: Record<string, string> = {};
  let photoServiceId = '';
  for (const [i, d] of defs.entries()) {
    const service = await tx.service.create({
      data: {
        tenantId,
        name: d.name,
        category: d.category,
        durationMinutes: d.minutes,
        requiredSkillId: d.skill,
        deliverableType: d.deliverable,
        sortOrder: i,
      },
    });
    if (d.category === 'photo') photoServiceId = service.id;
    for (const [j, [name, price]] of d.variants.entries()) {
      const v = await tx.serviceVariant.create({
        data: { tenantId, serviceId: service.id, name, basePrice: price, sortOrder: j },
      });
      variants[name] = v.id;
    }
  }

  // Size-band prices for the most common item.
  const bands = await tx.sizeBand.findMany({
    where: { deletedAt: null },
    orderBy: { minSize: 'asc' },
  });
  const bandPrices = [15_000, 17_500, 20_000, 25_000, 30_000];
  await tx.priceRule.createMany({
    data: bands.slice(0, bandPrices.length).map((b, i) => ({
      tenantId,
      itemKind: 'variant' as const,
      itemId: variants['25 photos']!,
      sizeBandId: b.id,
      propertyTypeId: null,
      price: bandPrices[i]!,
    })),
  });

  await tx.addOn.createMany({
    data: [
      { tenantId, name: 'Rush delivery (24 h)', basePrice: 5_000, maxQuantity: 1, sortOrder: 0 },
      {
        tenantId,
        name: '10 extra photos',
        serviceId: photoServiceId,
        basePrice: 4_000,
        maxQuantity: 5,
        sortOrder: 1,
      },
    ],
  });

  const essentials = await tx.package.create({
    data: {
      tenantId,
      name: 'Essentials',
      description: 'Photos and a floor plan',
      basePrice: 25_000,
      sortOrder: 0,
    },
  });
  await tx.packageItem.createMany({
    data: [
      { tenantId, packageId: essentials.id, variantId: variants['25 photos']! },
      { tenantId, packageId: essentials.id, variantId: variants['2D floor plan']! },
    ],
  });
  const premium = await tx.package.create({
    data: {
      tenantId,
      name: 'Premium',
      description: 'Photos, video and drone',
      basePrice: 65_000,
      sortOrder: 1,
    },
  });
  await tx.packageItem.createMany({
    data: [
      { tenantId, packageId: premium.id, variantId: variants['40 photos']! },
      { tenantId, packageId: premium.id, variantId: variants['Walkthrough video']! },
      { tenantId, packageId: premium.id, variantId: variants['10 aerial photos']! },
    ],
  });
  return true;
}
