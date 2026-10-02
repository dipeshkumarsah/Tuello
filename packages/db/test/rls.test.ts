import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, MissingTenantContextError, type Database } from '../src';
import { createTenantFixture, type TenantFixture } from './fixtures';
import { startTestDatabase, type TestDatabase } from './harness';

/**
 * Tenant isolation proofs. Every assertion runs as tuello_app (NOSUPERUSER NOBYPASSRLS) with
 * tenant A's context and targets tenant B's rows using plain SQL, so the result depends only on
 * the database policies, not on application code.
 */

// Primary key column per tenant-owned table.
const TENANT_TABLES: Record<keyof TenantFixture['ids'], { pk: string; tenantCol: string }> = {
  tenants: { pk: 'id', tenantCol: 'id' },
  tenant_domains: { pk: 'id', tenantCol: 'tenant_id' },
  tenant_brandings: { pk: 'tenant_id', tenantCol: 'tenant_id' },
  users: { pk: 'id', tenantCol: '' },
  memberships: { pk: 'id', tenantCol: 'tenant_id' },
  sessions: { pk: 'id', tenantCol: 'tenant_id' },
  invites: { pk: 'id', tenantCol: 'tenant_id' },
  auth_tokens: { pk: 'id', tenantCol: 'tenant_id' },
  audit_logs: { pk: 'id', tenantCol: 'tenant_id' },
  outbox_events: { pk: 'id', tenantCol: 'tenant_id' },
  feature_flags: { pk: 'id', tenantCol: 'tenant_id' },
};

// A harmless column to touch in UPDATE attempts.
const UPDATE_SQL: Record<string, string> = {
  tenants: `name = 'pwned'`,
  tenant_domains: `last_error = 'pwned'`,
  tenant_brandings: `email_sender_name = 'pwned'`,
  users: `name = 'pwned'`,
  memberships: `role = 'owner'`,
  sessions: `user_agent = 'pwned'`,
  invites: `role = 'owner'`,
  auth_tokens: `consumed_at = now()`,
  audit_logs: `action = 'pwned'`,
  outbox_events: `published_at = now()`,
  feature_flags: `enabled = false`,
};

let tdb: TestDatabase;
let db: Database;
let A: TenantFixture;
let B: TenantFixture;

async function asApp<T>(
  ctx: { tenantId?: string; userId?: string } | null,
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  const c = new Client({ connectionString: tdb.appUrl });
  await c.connect();
  try {
    await c.query('BEGIN');
    if (ctx?.tenantId)
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [ctx.tenantId]);
    if (ctx?.userId) await c.query(`SELECT set_config('app.user_id', $1, true)`, [ctx.userId]);
    const out = await fn(c);
    await c.query('ROLLBACK');
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}

beforeAll(async () => {
  tdb = await startTestDatabase();
  db = createDatabase({ url: tdb.appUrl });
  A = await createTenantFixture(db, tdb.adminUrl, 'alpha');
  B = await createTenantFixture(db, tdb.adminUrl, 'bravo');
});

afterAll(async () => {
  await db?.disconnect();
  await tdb?.stop();
});

describe('runtime role', () => {
  it('cannot bypass RLS', async () => {
    await expect(db.system.assertRuntimeRoleIsRestricted()).resolves.toEqual({
      role: 'tuello_app',
    });
  });
});

describe.each(Object.entries(TENANT_TABLES))('table %s: tenant A vs tenant B', (table, meta) => {
  const key = table as keyof TenantFixture['ids'];
  const ctxA = () => ({ tenantId: A.tenantId, userId: A.userId });

  it('cannot read B by id', async () => {
    const rows = await asApp(ctxA(), (c) =>
      c.query(`SELECT 1 FROM ${table} WHERE ${meta.pk} = $1`, [B.ids[key]]),
    );
    expect(rows.rowCount).toBe(0);
  });

  it('lists only its own rows', async () => {
    const rows = await asApp(ctxA(), (c) =>
      c.query<{ pk: string }>(`SELECT ${meta.pk}::text AS pk FROM ${table}`),
    );
    const pks = rows.rows.map((r) => r.pk);
    expect(pks).toContain(A.ids[key]);
    expect(pks).not.toContain(B.ids[key]);
    if (meta.tenantCol) {
      const tenants = await asApp(ctxA(), (c) =>
        c.query<{ t: string | null }>(`SELECT DISTINCT ${meta.tenantCol}::text AS t FROM ${table}`),
      );
      // feature_flags may also show platform defaults (tenant_id NULL); never another tenant.
      expect(tenants.rows.map((r) => r.t).filter((t) => t !== null)).toEqual([A.tenantId]);
    }
  });

  it('cannot update B', async () => {
    const result = await asApp(ctxA(), async (c) => {
      try {
        const r = await c.query(`UPDATE ${table} SET ${UPDATE_SQL[table]} WHERE ${meta.pk} = $1`, [
          B.ids[key],
        ]);
        return { updated: r.rowCount ?? 0, denied: false };
      } catch (e) {
        expect(String((e as Error).message)).toMatch(/permission denied|row-level security/);
        return { updated: 0, denied: true };
      }
    });
    expect(result.updated).toBe(0);
  });

  it('cannot delete B', async () => {
    const result = await asApp(ctxA(), async (c) => {
      try {
        const r = await c.query(`DELETE FROM ${table} WHERE ${meta.pk} = $1`, [B.ids[key]]);
        return r.rowCount ?? 0;
      } catch (e) {
        expect(String((e as Error).message)).toMatch(/permission denied|row-level security/);
        return 0;
      }
    });
    expect(result).toBe(0);
    // And B's row is still there.
    const still = await asApp({ tenantId: B.tenantId, userId: B.userId }, (c) =>
      c.query(`SELECT 1 FROM ${table} WHERE ${meta.pk} = $1`, [B.ids[key]]),
    );
    expect(still.rowCount).toBe(1);
  });
});

describe('cross-tenant inserts are rejected', () => {
  const ctxA = () => ({ tenantId: A.tenantId, userId: A.userId });
  const cases: Array<[string, string, (b: TenantFixture) => unknown[]]> = [
    [
      'tenant_domains',
      `INSERT INTO tenant_domains (tenant_id, hostname, verification_token) VALUES ($1, 'x.evil.test', 't')`,
      (b) => [b.tenantId],
    ],
    [
      'memberships',
      `INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'owner')`,
      (b) => [b.tenantId, A.userId],
    ],
    [
      'sessions',
      `INSERT INTO sessions (tenant_id, user_id, token_hash, expires_at) VALUES ($1, $2, 'h', now())`,
      (b) => [b.tenantId, A.userId],
    ],
    [
      'invites',
      `INSERT INTO invites (tenant_id, email, role, token_hash, expires_at) VALUES ($1, 'x@y.z', 'owner', 'h', now())`,
      (b) => [b.tenantId],
    ],
    [
      'auth_tokens',
      `INSERT INTO auth_tokens (tenant_id, user_id, purpose, token_hash, expires_at) VALUES ($1, $2, 'magic_link', 'h', now())`,
      (b) => [b.tenantId, A.userId],
    ],
    [
      'audit_logs',
      `INSERT INTO audit_logs (tenant_id, action, entity_type) VALUES ($1, 'x', 'y')`,
      (b) => [b.tenantId],
    ],
    [
      'outbox_events',
      `INSERT INTO outbox_events (tenant_id, name, aggregate_type) VALUES ($1, 'x', 'y')`,
      (b) => [b.tenantId],
    ],
    [
      'tenant_brandings',
      `INSERT INTO tenant_brandings (tenant_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      (b) => [b.tenantId],
    ],
    [
      'tenants',
      `INSERT INTO tenants (id, slug, name) VALUES ($1, 'sneaky', 'x')`,
      () => ['0190a0a0-0000-7000-8000-000000000000'],
    ],
  ];
  it.each(cases)('%s', async (_t, sql, params) => {
    await expect(asApp(ctxA(), (c) => c.query(sql, params(B)))).rejects.toThrow(
      /row-level security/,
    );
  });

  it('tenant A cannot move its own row into tenant B', async () => {
    await expect(
      asApp(ctxA(), (c) =>
        c.query(`UPDATE memberships SET tenant_id = $1 WHERE id = $2`, [
          B.tenantId,
          A.ids.memberships,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe('users (global identity)', () => {
  it('only exposes users who belong to the current tenant, or yourself', async () => {
    const rows = await asApp({ tenantId: A.tenantId }, (c) =>
      c.query<{ id: string }>(`SELECT id::text FROM users`),
    );
    expect(rows.rows.map((r) => r.id)).toEqual([A.userId]);
  });

  it('cannot update another user, even in the same tenant', async () => {
    const r = await asApp({ tenantId: A.tenantId, userId: undefined }, (c) =>
      c.query(`UPDATE users SET name = 'x' WHERE id = $1`, [A.userId]),
    );
    expect(r.rowCount).toBe(0);
  });
});

describe('a query made without tenant context throws', () => {
  it('in Prisma, before reaching the database', async () => {
    await expect(db.client.membership.findMany()).rejects.toBeInstanceOf(MissingTenantContextError);
    await expect(db.client.tenant.findFirst()).rejects.toBeInstanceOf(MissingTenantContextError);
    await expect(
      db.client.auditLog.create({ data: { tenantId: A.tenantId, action: 'x', entityType: 'y' } }),
    ).rejects.toBeInstanceOf(MissingTenantContextError);
    expect(() => db.tx.user).toThrow(MissingTenantContextError);
  });

  it('in SQL, at the database (RLS policy raises)', async () => {
    for (const table of ['tenants', 'memberships', 'sessions', 'invites', 'users', 'audit_logs']) {
      await expect(asApp(null, (c) => c.query(`SELECT * FROM ${table}`))).rejects.toThrow(
        /tenant context missing/,
      );
    }
    await expect(
      asApp(null, (c) =>
        c.query(`INSERT INTO audit_logs (tenant_id, action, entity_type) VALUES ($1,'x','y')`, [
          A.tenantId,
        ]),
      ),
    ).rejects.toThrow(/tenant context missing/);
  });

  it('after a scoped transaction ends, the pooled connection carries no context', async () => {
    const c = new Client({ connectionString: tdb.appUrl });
    await c.connect();
    await c.query('BEGIN');
    await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [A.tenantId]);
    await c.query('COMMIT');
    await expect(c.query('SELECT * FROM memberships')).rejects.toThrow(/tenant context missing/);
    await c.end();
  });

  it('webhook_events is closed to the app role', async () => {
    await expect(
      asApp({ tenantId: A.tenantId }, (c) => c.query('SELECT * FROM webhook_events')),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('Prisma tenant extension', () => {
  it('scopes queries to the context tenant', async () => {
    const memberships = await db.withTenant({ tenantId: A.tenantId }, (tx) =>
      tx.membership.findMany(),
    );
    expect(memberships.map((m) => m.tenantId)).toEqual([A.tenantId]);
  });

  it('exposes the open transaction through db.tx', async () => {
    const count = await db.withTenant({ tenantId: B.tenantId }, () => db.tx.invite.count());
    expect(count).toBe(1);
  });

  it('refuses to nest a different tenant', async () => {
    await expect(
      db.withTenant({ tenantId: A.tenantId }, () =>
        db.withTenant({ tenantId: B.tenantId }, async () => 1),
      ),
    ).rejects.toThrow(/refusing to nest/);
  });

  it('rolls back on error and runs afterCommit only on success', async () => {
    const calls: string[] = [];
    await expect(
      db.withTenant({ tenantId: A.tenantId, userId: A.userId }, async (tx) => {
        await tx.auditLog.create({
          data: { tenantId: A.tenantId, action: 'rolled.back', entityType: 'x' },
        });
        db.afterCommit(() => calls.push('nope'));
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const found = await db.withTenant({ tenantId: A.tenantId }, (tx) =>
      tx.auditLog.count({ where: { action: 'rolled.back' } }),
    );
    expect(found).toBe(0);
    await db.withTenant({ tenantId: A.tenantId }, async () => {
      db.afterCommit(() => calls.push('yes'));
    });
    expect(calls).toEqual(['yes']);
  });

  it('rejects non-UUID tenant ids', async () => {
    await expect(db.withTenant({ tenantId: "x' OR 1=1" }, async () => 1)).rejects.toThrow(/UUID/);
  });
});

describe('SECURITY DEFINER lookups', () => {
  it('resolve tenants by slug and verified domain only', async () => {
    expect((await db.system.tenantBySlug('alpha'))?.id).toBe(A.tenantId);
    expect(await db.system.tenantBySlug('nobody')).toBeNull();
    expect(await db.system.tenantByDomain('media.alpha.test')).toBeNull(); // pending, not verified
    await db.withTenant({ tenantId: A.tenantId }, (tx) =>
      tx.tenantDomain.update({ where: { id: A.ids.tenant_domains }, data: { status: 'verified' } }),
    );
    expect((await db.system.tenantByDomain('media.alpha.test'))?.id).toBe(A.tenantId);
  });

  it('find users by email without exposing other columns', async () => {
    const u = await db.system.findUserByEmail('OWNER@bravo.test');
    expect(u?.id).toBe(B.userId);
    expect(Object.keys(u!).sort()).toEqual([
      'emailVerifiedAt',
      'id',
      'name',
      'passwordHash',
      'totpEnabled',
    ]);
  });

  it('reports slug availability', async () => {
    expect(await db.system.slugAvailable('alpha')).toBe(false);
    expect(await db.system.slugAvailable('charlie')).toBe(true);
  });

  it('claims outbox events once and marks them published', async () => {
    const first = await db.system.claimOutboxEvents(100, 30);
    expect(first.map((e) => e.tenantId).sort()).toEqual([A.tenantId, B.tenantId].sort());
    const second = await db.system.claimOutboxEvents(100, 30);
    expect(second).toHaveLength(0); // leased
    expect(await db.system.markOutboxPublished(first.map((e) => e.id))).toBe(2);
  });

  it('stores webhook events once per provider id', async () => {
    const a = await db.system.recordWebhookEvent({
      provider: 'stripe',
      providerEventId: 'evt_1',
      type: 't',
      payload: { a: 1 },
      tenantId: null,
    });
    const b = await db.system.recordWebhookEvent({
      provider: 'stripe',
      providerEventId: 'evt_1',
      type: 't',
      payload: { a: 1 },
      tenantId: null,
    });
    expect(a.duplicate).toBe(false);
    expect(b).toEqual({ id: a.id, duplicate: true });
  });
});

describe('schema guard rails (catch tables added without isolation)', () => {
  async function admin<T>(fn: (c: Client) => Promise<T>) {
    const c = new Client({ connectionString: tdb.adminUrl });
    await c.connect();
    try {
      return await fn(c);
    } finally {
      await c.end();
    }
  }

  it('every public table has RLS enabled and forced', async () => {
    const r = await admin((c) =>
      c.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations'`,
      ),
    );
    expect(r.rows.length).toBeGreaterThanOrEqual(11);
    for (const row of r.rows) {
      expect({
        table: row.relname,
        rls: row.relrowsecurity,
        force: row.relforcerowsecurity,
      }).toEqual({
        table: row.relname,
        rls: true,
        force: true,
      });
    }
  });

  const NULLABLE_TENANT = new Set(['webhook_events', 'feature_flags']);
  const INDEX_EXCEPTIONS = new Set([
    'tenant_domains_pkey',
    'tenant_domains_hostname_live_key',
    'tenant_domains_pending_check_idx',
    'outbox_events_unpublished_idx',
    'webhook_events_provider_provider_event_id_key',
  ]);

  it('tenant_id is NOT NULL with a FK to tenants, and leads every index', async () => {
    const cols = await admin((c) =>
      c.query<{ table_name: string; is_nullable: string }>(
        `SELECT table_name, is_nullable FROM information_schema.columns
         WHERE table_schema = 'public' AND column_name = 'tenant_id'`,
      ),
    );
    for (const col of cols.rows) {
      if (!NULLABLE_TENANT.has(col.table_name))
        expect([col.table_name, col.is_nullable]).toEqual([col.table_name, 'NO']);
    }
    const fks = await admin((c) =>
      c.query<{ table_name: string }>(
        `SELECT tc.table_name FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage k ON k.constraint_name = tc.constraint_name
         JOIN information_schema.constraint_column_usage u ON u.constraint_name = tc.constraint_name
         WHERE tc.constraint_type = 'FOREIGN KEY' AND k.column_name = 'tenant_id' AND u.table_name = 'tenants'`,
      ),
    );
    const withFk = new Set(fks.rows.map((r) => r.table_name));
    for (const col of cols.rows) {
      if (col.table_name !== 'webhook_events')
        expect([col.table_name, withFk.has(col.table_name)]).toEqual([col.table_name, true]);
    }
    const idx = await admin((c) =>
      c.query<{ tablename: string; indexname: string; first_col: string }>(
        `SELECT t.relname AS tablename, i.relname AS indexname, a.attname AS first_col
         FROM pg_index x
         JOIN pg_class i ON i.oid = x.indexrelid
         JOIN pg_class t ON t.oid = x.indrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = x.indkey[0]
         WHERE n.nspname = 'public' AND t.relname IN (
           SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'tenant_id'
         )`,
      ),
    );
    for (const row of idx.rows) {
      if (INDEX_EXCEPTIONS.has(row.indexname) || row.indexname.endsWith('_pkey')) continue;
      expect([row.indexname, row.first_col]).toEqual([row.indexname, 'tenant_id']);
    }
  });
});
