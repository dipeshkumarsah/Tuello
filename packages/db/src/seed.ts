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
      console.warn(`seed: tenant "${t.slug}" exists, skipping`);
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
