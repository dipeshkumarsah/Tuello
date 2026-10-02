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
    brokerages: string;
    clients: string;
    client_contacts: string;
    tags: string;
    client_tags: string;
    notes: string;
    client_activities: string;
    saved_views: string;
    import_jobs: string;
    export_jobs: string;
    skills: string;
    services: string;
    service_variants: string;
    packages: string;
    package_items: string;
    add_ons: string;
    property_types: string;
    size_bands: string;
    price_rules: string;
    client_price_lists: string;
    client_price_list_items: string;
    territories: string;
    travel_fee_rules: string;
    coupons: string;
    coupon_redemptions: string;
    tax_rates: string;
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

    // Phase 2: one row in every CRM, catalog and pricing table.
    const priceList = await tx.clientPriceList.create({ data: { tenantId, name: 'VIP' } });
    const brokerage = await tx.brokerage.create({
      data: { tenantId, name: `${slug} Realty`, priceListId: priceList.id },
    });
    const client = await tx.client.create({
      data: {
        tenantId,
        firstName: 'Ann',
        lastName: slug,
        sortName: `${slug} ann`,
        email: `ann@${slug}.test`,
        brokerageId: brokerage.id,
      },
    });
    const contact = await tx.clientContact.create({
      data: { tenantId, clientId: client.id, name: 'Assistant' },
    });
    const tag = await tx.tag.create({ data: { tenantId, name: 'vip' } });
    await tx.clientTag.create({ data: { tenantId, clientId: client.id, tagId: tag.id } });
    const note = await tx.note.create({
      data: { tenantId, clientId: client.id, body: 'Prefers mornings', authorUserId: user.id },
    });
    const activity = await tx.clientActivity.create({
      data: { tenantId, clientId: client.id, type: 'created' },
    });
    const view = await tx.savedView.create({
      data: { tenantId, userId: user.id, entity: 'clients', name: 'Mine' },
    });
    const imp = await tx.importJob.create({
      data: {
        tenantId,
        entity: 'clients',
        fileKey: `${tenantId}/imports/x.csv`,
        fileName: 'x.csv',
        fileSize: 1,
      },
    });
    const exp = await tx.exportJob.create({ data: { tenantId, entity: 'clients' } });
    const skill = await tx.skill.create({ data: { tenantId, name: 'Drone pilot' } });
    const service = await tx.service.create({
      data: {
        tenantId,
        name: 'Photography',
        category: 'photo',
        durationMinutes: 60,
        deliverableType: 'photos',
        requiredSkillId: skill.id,
      },
    });
    const variant = await tx.serviceVariant.create({
      data: { tenantId, serviceId: service.id, name: '25 photos', basePrice: 15000 },
    });
    const pkg = await tx.package.create({
      data: { tenantId, name: 'Essentials', basePrice: 30000 },
    });
    await tx.packageItem.create({ data: { tenantId, packageId: pkg.id, variantId: variant.id } });
    const addOn = await tx.addOn.create({
      data: { tenantId, serviceId: service.id, name: 'Twilight', basePrice: 5000 },
    });
    const ptype = await tx.propertyType.create({ data: { tenantId, key: 'house', name: 'House' } });
    const band = await tx.sizeBand.create({
      data: { tenantId, name: 'Small', minSize: 0, maxSize: 2000 },
    });
    const rule = await tx.priceRule.create({
      data: {
        tenantId,
        itemKind: 'variant',
        itemId: variant.id,
        sizeBandId: band.id,
        propertyTypeId: ptype.id,
        price: 16000,
      },
    });
    const listItem = await tx.clientPriceListItem.create({
      data: {
        tenantId,
        priceListId: priceList.id,
        itemKind: 'variant',
        itemId: variant.id,
        fixedPrice: 12000,
      },
    });
    const territory = await tx.territory.create({
      data: { tenantId, name: 'North', postalPrefixes: ['941'] },
    });
    const travel = await tx.travelFeeRule.create({
      data: { tenantId, name: 'North', kind: 'territory', territoryId: territory.id, fee: 2500 },
    });
    const coupon = await tx.coupon.create({
      data: { tenantId, code: 'SPRING', kind: 'percent', percentOffBps: 1000 },
    });
    const redemption = await tx.couponRedemption.create({
      data: { tenantId, couponId: coupon.id, clientId: client.id, amount: 1500 },
    });
    const tax = await tx.taxRate.create({
      data: { tenantId, name: 'Sales tax', rateBps: 725, regionCode: 'US-CA' },
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
      brokerages: brokerage.id,
      clients: client.id,
      client_contacts: contact.id,
      tags: tag.id,
      client_tags: client.id,
      notes: note.id,
      client_activities: activity.id,
      saved_views: view.id,
      import_jobs: imp.id,
      export_jobs: exp.id,
      skills: skill.id,
      services: service.id,
      service_variants: variant.id,
      packages: pkg.id,
      package_items: pkg.id,
      add_ons: addOn.id,
      property_types: ptype.id,
      size_bands: band.id,
      price_rules: rule.id,
      client_price_lists: priceList.id,
      client_price_list_items: listItem.id,
      territories: territory.id,
      travel_fee_rules: travel.id,
      coupons: coupon.id,
      coupon_redemptions: redemption.id,
      tax_rates: tax.id,
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
