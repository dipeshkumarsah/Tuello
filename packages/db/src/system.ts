import type { PrismaClient } from '@prisma/client';

/**
 * Typed wrappers over the SECURITY DEFINER functions in the `app` schema. These are the only
 * queries allowed without a tenant context. Each returns the minimum its caller needs.
 */
export interface TenantLookup {
  id: string;
  slug: string;
  name: string;
  status: 'onboarding' | 'active' | 'suspended';
}

export interface UserLoginLookup {
  id: string;
  name: string;
  passwordHash: string | null;
  emailVerifiedAt: Date | null;
  totpEnabled: boolean;
}

export interface ClaimedOutboxEvent {
  id: string;
  tenantId: string;
  name: string;
  aggregateType: string;
  aggregateId: string | null;
  payload: unknown;
  occurredAt: Date;
  attempts: number;
}

type Raw = Pick<PrismaClient, '$queryRaw'>;

export function createSystemQueries(client: Raw) {
  return {
    async tenantBySlug(slug: string): Promise<TenantLookup | null> {
      const rows = await client.$queryRaw<
        TenantLookup[]
      >`SELECT id::text, slug, name, status::text AS status FROM app.tenant_by_slug(${slug})`;
      return rows[0] ?? null;
    },

    async tenantByDomain(hostname: string): Promise<TenantLookup | null> {
      const rows = await client.$queryRaw<
        TenantLookup[]
      >`SELECT id::text, slug, name, status::text AS status FROM app.tenant_by_domain(${hostname})`;
      return rows[0] ?? null;
    },

    async slugAvailable(slug: string): Promise<boolean> {
      const rows = await client.$queryRaw<
        Array<{ available: boolean }>
      >`SELECT app.slug_available(${slug}) AS available`;
      return rows[0]?.available ?? false;
    },

    async findUserByEmail(email: string): Promise<UserLoginLookup | null> {
      const rows = await client.$queryRaw<
        Array<{
          id: string;
          name: string;
          password_hash: string | null;
          email_verified_at: Date | null;
          totp_enabled: boolean;
        }>
      >`SELECT id::text, name, password_hash, email_verified_at, totp_enabled FROM app.find_user_by_email(${email})`;
      const r = rows[0];
      if (!r) return null;
      return {
        id: r.id,
        name: r.name,
        passwordHash: r.password_hash,
        emailVerifiedAt: r.email_verified_at,
        totpEnabled: r.totp_enabled,
      };
    },

    async domainsDueForCheck(limit: number): Promise<Array<{ id: string; tenantId: string }>> {
      const rows = await client.$queryRaw<
        Array<{ id: string; tenant_id: string }>
      >`SELECT id::text, tenant_id::text FROM app.domains_due_for_check(${limit}::int)`;
      return rows.map((r) => ({ id: r.id, tenantId: r.tenant_id }));
    },

    async claimOutboxEvents(limit: number, leaseSeconds: number): Promise<ClaimedOutboxEvent[]> {
      const rows = await client.$queryRaw<
        Array<{
          id: string;
          tenant_id: string;
          name: string;
          aggregate_type: string;
          aggregate_id: string | null;
          payload: unknown;
          occurred_at: Date;
          attempts: number;
        }>
      >`SELECT id::text, tenant_id::text, name, aggregate_type, aggregate_id::text, payload, occurred_at, attempts FROM app.claim_outbox_events(${limit}::int, ${leaseSeconds}::int)`;
      return rows.map((r) => ({
        id: r.id,
        tenantId: r.tenant_id,
        name: r.name,
        aggregateType: r.aggregate_type,
        aggregateId: r.aggregate_id,
        payload: r.payload,
        occurredAt: r.occurred_at,
        attempts: r.attempts,
      }));
    },

    async markOutboxPublished(ids: string[]): Promise<number> {
      if (ids.length === 0) return 0;
      const rows = await client.$queryRaw<
        Array<{ n: number }>
      >`SELECT app.mark_outbox_published(${ids}::uuid[]) AS n`;
      return rows[0]?.n ?? 0;
    },

    async recordWebhookEvent(input: {
      provider: string;
      providerEventId: string;
      type: string;
      payload: unknown;
      tenantId: string | null;
    }): Promise<{ id: string; duplicate: boolean }> {
      const rows = await client.$queryRaw<
        Array<{ id: string; duplicate: boolean }>
      >`SELECT id::text, duplicate FROM app.record_webhook_event(${input.provider}, ${input.providerEventId}, ${input.type}, ${JSON.stringify(input.payload)}::jsonb, ${input.tenantId}::uuid)`;
      return rows[0]!;
    },

    /** Readiness probe; touches no table. */
    async ping(): Promise<void> {
      await client.$queryRaw`SELECT 1`;
    },

    /** Refuses to run as a role that can bypass RLS. Called at api/worker startup. */
    async assertRuntimeRoleIsRestricted(): Promise<{ role: string }> {
      const rows = await client.$queryRaw<
        Array<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>
      >`SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
      const r = rows[0];
      if (!r) throw new Error('Could not read current database role');
      if (r.rolsuper || r.rolbypassrls) {
        throw new Error(
          `Database role "${r.rolname}" is superuser or BYPASSRLS. The runtime must connect as tuello_app.`,
        );
      }
      return { role: r.rolname };
    },
  };
}

export type SystemQueries = ReturnType<typeof createSystemQueries>;
