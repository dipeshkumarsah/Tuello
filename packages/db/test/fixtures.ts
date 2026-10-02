import { createHash, randomBytes } from 'node:crypto';
import { Client } from 'pg';
import type { Database } from '../src';
import { uuidv7 } from '../src';

export interface TenantFixture {
  tenantId: string;
  slug: string;
  userId: string;
  ids: {
    tenants: string;
    tenant_domains: string;
    tenant_brandings: string;
    users: string;
    memberships: string;
    sessions: string;
    invites: string;
    auth_tokens: string;
    audit_logs: string;
    outbox_events: string;
    feature_flags: string;
  };
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex');

/** Creates a tenant with exactly one row in every tenant-owned table, through the app role. */
export async function createTenantFixture(
  db: Database,
  adminUrl: string,
  slug: string,
): Promise<TenantFixture> {
  const tenantId = uuidv7();
  const userId = uuidv7();
  const ids = await db.withTenant({ tenantId, userId }, async (tx) => {
    const tenant = await tx.tenant.create({ data: { id: tenantId, slug, name: `${slug} media` } });
    const user = await tx.user.create({
      data: { id: userId, email: `owner@${slug}.test`, name: `${slug} owner` },
    });
    const membership = await tx.membership.create({
      data: { tenantId, userId: user.id, role: 'owner' },
    });
    const branding = await tx.tenantBranding.create({ data: { tenantId, accentColor: '#1D3557' } });
    const domain = await tx.tenantDomain.create({
      data: {
        tenantId,
        hostname: `media.${slug}.test`,
        verificationToken: randomBytes(8).toString('hex'),
      },
    });
    const session = await tx.session.create({
      data: {
        tenantId,
        userId: user.id,
        tokenHash: hash(randomBytes(16).toString('hex')),
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    const invite = await tx.invite.create({
      data: {
        tenantId,
        email: `invitee@${slug}.test`,
        role: 'coordinator',
        tokenHash: hash(randomBytes(16).toString('hex')),
        invitedByUserId: user.id,
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    const token = await tx.authToken.create({
      data: {
        tenantId,
        userId: user.id,
        purpose: 'verify_email',
        tokenHash: hash(randomBytes(16).toString('hex')),
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    const audit = await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId: user.id,
        action: 'tenant.created',
        entityType: 'tenant',
        entityId: tenantId,
      },
    });
    const outbox = await tx.outboxEvent.create({
      data: { tenantId, name: 'tenant.created', aggregateType: 'tenant', aggregateId: tenantId },
    });
    return {
      tenants: tenant.id,
      tenant_domains: domain.id,
      tenant_brandings: branding.tenantId,
      users: user.id,
      memberships: membership.id,
      sessions: session.id,
      invites: invite.id,
      auth_tokens: token.id,
      audit_logs: audit.id,
      outbox_events: outbox.id,
    };
  });

  // tuello_app cannot write feature flags (platform-controlled), so seed the tenant override as admin.
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  const flag = await admin.query<{ id: string }>(
    `INSERT INTO feature_flags (tenant_id, key, enabled) VALUES ($1, 'sms', true) RETURNING id`,
    [tenantId],
  );
  await admin.end();

  return { tenantId, slug, userId, ids: { ...ids, feature_flags: flag.rows[0]!.id } };
}
