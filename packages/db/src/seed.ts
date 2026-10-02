/**
 * Development seed: two demo tenants (acme, birch) with one verified user per role.
 * Runs through the RLS-restricted runtime role, exactly like the API. Idempotent.
 *
 *   pnpm db:seed            (uses DATABASE_URL)
 *
 * Every demo user's password is SEED_PASSWORD (default "tuello-demo-password").
 */
import { ROLES, type Role } from '@tuello/shared';
import { createDatabase } from './database';
import { seedStarterCatalog } from './defaults';
import { hashPassword } from './password';
import { uuidv7 } from './uuid';

const TENANTS = [
  {
    slug: 'acme',
    name: 'Acme Real Estate Media',
    timeZone: 'America/New_York',
    currency: 'USD',
    unit: 'sqft' as const,
  },
  {
    slug: 'birch',
    name: 'Birch Property Photography',
    timeZone: 'Europe/London',
    currency: 'GBP',
    unit: 'm2' as const,
  },
];

const DEMO_NAMES: Record<Role, string> = {
  owner: 'Olive Owner',
  admin: 'Adam Admin',
  coordinator: 'Cora Coordinator',
  shooter: 'Sam Shooter',
  editor: 'Edie Editor',
  client: 'Clara Client',
  brokerage_admin: 'Bree Broker',
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const password = process.env.SEED_PASSWORD ?? 'tuello-demo-password';
  const db = createDatabase({ url });
  const passwordHash = await hashPassword(password);

  for (const t of TENANTS) {
    const existing = await db.system.tenantBySlug(t.slug);
    if (existing) {
      await seedPhase2(db, existing.id, t.unit, t.slug);
      continue;
    }
    const tenantId = uuidv7();
    await db.withTenant({ tenantId }, async (tx) => {
      await tx.tenant.create({
        data: {
          id: tenantId,
          slug: t.slug,
          name: t.name,
          status: 'active',
          timeZone: t.timeZone,
          currency: t.currency,
          measurementUnit: t.unit,
          taxLabel: t.currency === 'GBP' ? 'VAT' : 'Sales tax',
          onboardingCompletedAt: new Date(),
        },
      });
      await tx.tenantBranding.create({ data: { tenantId, emailSenderName: t.name } });
      for (const role of ROLES as readonly Role[]) {
        const email = `${role.replace('_', '-')}@${t.slug}.test`;
        const userId = uuidv7();
        await db.setUser(userId);
        await tx.user.create({
          data: {
            id: userId,
            email,
            name: DEMO_NAMES[role],
            passwordHash,
            emailVerifiedAt: new Date(),
          },
        });
        await tx.membership.create({ data: { tenantId, userId, role } });
      }
      await tx.outboxEvent.create({
        data: {
          tenantId,
          name: 'tenant.created',
          aggregateType: 'tenant',
          aggregateId: tenantId,
          payload: { seeded: true },
        },
      });
    });
    console.warn(
      `seed: created ${t.slug} with users ${ROLES.map((r) => `${r.replace('_', '-')}@${t.slug}.test`).join(', ')}`,
    );
  }
  await db.disconnect();
}

/** Catalog, pricing and a small CRM for a demo tenant. Each part is skipped if already present. */
async function seedPhase2(
  db: ReturnType<typeof createDatabase>,
  tenantId: string,
  unit: 'sqft' | 'm2',
  slug: string,
) {
  await db.withTenant({ tenantId }, async (tx) => {
    const created = await seedStarterCatalog(tx, tenantId, unit);
    if (created) console.warn(`seed: ${slug} starter catalog`);
    if ((await tx.clientPriceList.count()) === 0) {
      await tx.clientPriceList.create({
        data: {
          tenantId,
          name: 'Top producers',
          description: '10% off everything',
          defaultPercentOffBps: 1_000,
        },
      });
      await tx.coupon.create({
        data: {
          tenantId,
          code: 'WELCOME10',
          description: 'First order',
          kind: 'percent',
          percentOffBps: 1_000,
          maxPerClient: 1,
        },
      });
      await tx.taxRate.create({
        data:
          unit === 'm2'
            ? { tenantId, name: 'VAT', rateBps: 2_000, regionCode: 'GB', appliesToTravel: true }
            : {
                tenantId,
                name: 'Sales tax',
                rateBps: 875,
                regionCode: 'US-NY',
                appliesToTravel: false,
              },
      });
      const territory = await tx.territory.create({
        data: {
          tenantId,
          name: 'Downtown',
          postalPrefixes: unit === 'm2' ? ['EC', 'WC'] : ['100'],
        },
      });
      await tx.travelFeeRule.create({
        data: {
          tenantId,
          name: 'Downtown parking',
          kind: 'territory',
          territoryId: territory.id,
          fee: 2_500,
          priority: 1,
        },
      });
      await tx.travelFeeRule.create({
        data: {
          tenantId,
          name: 'Mileage',
          kind: 'distance',
          freeKm: 30,
          perKm: 120,
          minFee: 1_000,
          maxFee: 15_000,
          priority: 10,
        },
      });
    }
    if ((await tx.client.count()) === 0) {
      const brokerages = await Promise.all(
        ['Harbor Realty', 'Summit Properties', 'Keystone Homes'].map((name) =>
          tx.brokerage.create({
            data: { tenantId, name, city: unit === 'm2' ? 'London' : 'New York' },
          }),
        ),
      );
      const people = [
        ['Maya', 'Chen'],
        ['Luis', 'Ortega'],
        ['Priya', 'Natarajan'],
        ['Tom', 'Becker'],
        ['Ava', 'Goldberg'],
        ['Noah', 'Williams'],
        ['Zoe', 'Martin'],
        ['Ethan', 'Brooks'],
        ['Isla', 'Murphy'],
        ['Omar', 'Haddad'],
        ['Grace', 'Kim'],
        ['Leo', 'Rossi'],
      ];
      for (const [i, [first, last]] of people.entries()) {
        const email = `${first!.toLowerCase()}.${last!.toLowerCase()}@${slug}-agents.test`;
        await tx.client.create({
          data: {
            tenantId,
            firstName: first!,
            lastName: last!,
            sortName: `${last} ${first} ${email}`.toLowerCase(),
            email,
            phone: `+1 212 555 01${String(i).padStart(2, '0')}`,
            phoneNormalized: `21255501${String(i).padStart(2, '0')}`,
            brokerageId: brokerages[i % 3]!.id,
          },
        });
      }
      console.warn(`seed: ${slug} demo brokerages and clients`);
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
