import { createDatabase, uuidv7, type Database } from '@tuello/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Job } from 'bullmq';
import { loadEnv, type WorkerEnv } from '../src/config';
import { createLogger } from '../src/infra/logger';
import { Storage } from '../src/infra/storage';
import { ExportProcessor } from '../src/jobs/export.processor';
import { ImportProcessor } from '../src/jobs/import.processor';

const log = createLogger('silent', false);
let env: WorkerEnv;
let db: Database;
let storage: Storage;

beforeAll(() => {
  env = loadEnv({
    DATABASE_URL: inject('appDbUrl'),
    VALKEY_URL: inject('valkeyUrl'),
    S3_ENDPOINT: inject('s3Endpoint'),
    S3_ACCESS_KEY_ID: 'tuello',
    S3_SECRET_ACCESS_KEY: 'tuello-dev-secret',
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'tuello',
    S3_FORCE_PATH_STYLE: 'true',
  } as NodeJS.ProcessEnv);
  db = createDatabase({ url: env.DATABASE_URL });
  storage = new Storage(env);
});
afterAll(async () => {
  await db?.disconnect();
});

async function tenant() {
  const tenantId = uuidv7();
  await db.withTenant({ tenantId }, (tx) =>
    tx.tenant.create({
      data: { id: tenantId, slug: `imp${tenantId.slice(-10)}`, name: 'Import Co' },
    }),
  );
  return tenantId;
}

async function importJob(
  tenantId: string,
  entity: 'clients' | 'brokerages',
  csv: string,
  mapping: Record<string, string>,
) {
  const id = uuidv7();
  const fileKey = `${tenantId}/imports/${id}.csv`;
  await storage.put(fileKey, csv);
  await db.withTenant({ tenantId }, (tx) =>
    tx.importJob.create({
      data: {
        id,
        tenantId,
        entity,
        fileKey,
        fileName: 'f.csv',
        fileSize: csv.length,
        status: 'queued',
        mapping,
      },
    }),
  );
  return id;
}

const run = (tenantId: string, importId: string) =>
  new ImportProcessor(db, storage, log).process({
    data: { tenantId, importId, userId: null },
    updateProgress: async () => {},
  } as unknown as Job);

const MAPPING = {
  firstName: 'first',
  lastName: 'last',
  email: 'email',
  phone: 'phone',
  brokerage: 'brokerage',
  tags: 'tags',
  externalRef: 'id',
};

function bigCsv(n: number) {
  const rows = ['first,last,email,phone,brokerage,tags,id'];
  for (let i = 0; i < n; i++) {
    rows.push(
      `Agent${i},Person${i},agent${i}@bulk.example,512555${String(i).padStart(4, '0')},Brokerage ${i % 25},"tag${i % 5}, all",`,
    );
  }
  return rows.join('\n');
}

describe('client import job', () => {
  it('imports 5,000 clients in batches, and a re-run creates no duplicates', async () => {
    const tenantId = await tenant();
    const csv = bigCsv(5000);
    const first = await importJob(tenantId, 'clients', csv, MAPPING);
    const started = Date.now();
    expect(await run(tenantId, first)).toEqual({
      rows: 5000,
      created: 5000,
      updated: 0,
      errors: 0,
    });
    const seconds = (Date.now() - started) / 1000;
    expect(seconds).toBeLessThan(120);

    const counts = await db.withTenant({ tenantId }, async (tx) => ({
      clients: await tx.client.count({ where: { deletedAt: null } }),
      brokerages: await tx.brokerage.count(),
      tags: await tx.tag.count(),
      links: await tx.clientTag.count(),
      job: await tx.importJob.findUniqueOrThrow({ where: { id: first } }),
      event: await tx.outboxEvent.findFirst({
        where: { name: 'import.completed', aggregateId: first },
      }),
    }));
    expect(counts).toMatchObject({ clients: 5000, brokerages: 25, tags: 6, links: 10_000 });
    expect(counts.job).toMatchObject({
      status: 'completed',
      processedRows: 5000,
      createdCount: 5000,
      errorCount: 0,
      errorReportKey: null,
    });
    expect(counts.event?.payload).toMatchObject({ rows: 5000, created: 5000 });

    // Same file again: every row matches by email, nothing new.
    const second = await importJob(tenantId, 'clients', csv, MAPPING);
    expect(await run(tenantId, second)).toEqual({
      rows: 5000,
      created: 0,
      updated: 5000,
      errors: 0,
    });
    expect(
      await db.withTenant({ tenantId }, (tx) => tx.client.count({ where: { deletedAt: null } })),
    ).toBe(5000);

    // Re-running a completed job is a no-op (BullMQ retries are safe).
    expect(await run(tenantId, second)).toEqual({ skipped: 'already-completed' });
  }, 180_000);

  it('matches by external ID, then email, then name + phone; reports bad rows', async () => {
    const tenantId = await tenant();
    const seed = await importJob(
      tenantId,
      'clients',
      [
        'first,last,email,phone,brokerage,tags,id',
        'Ana,Lopez,ana@x.example,,Harbor,,crm-1',
        'Bo,Diaz,,512 555 0001,,,',
      ].join('\n'),
      MAPPING,
    );
    await run(tenantId, seed);
    const csv = [
      'first,last,email,phone,brokerage,tags,id',
      'Ana,Lopez-Ruiz,ana.new@x.example,,,,crm-1', // external ID wins: updates name + email
      'Bo,Diaz,,+1 (512) 555-0001,HARBOR,,', // name + phone match, brokerage name case-insensitive
      'Cy,Bad,not-an-email,,,,', // invalid
      'No,Key,,,,,', // no dedupe key
      'Dee,New,dee@x.example,,,,',
    ].join('\n');
    const id = await importJob(tenantId, 'clients', csv, MAPPING);
    expect(await run(tenantId, id)).toEqual({ rows: 5, created: 1, updated: 2, errors: 2 });

    const clients = await db.withTenant({ tenantId }, (tx) =>
      tx.client.findMany({
        where: { deletedAt: null },
        include: { brokerage: true },
        orderBy: { sortName: 'asc' },
      }),
    );
    expect(
      clients.map((c) => [c.firstName, c.lastName, c.email, c.brokerage?.name ?? null]),
    ).toEqual([
      ['Bo', 'Diaz', null, 'Harbor'],
      ['Ana', 'Lopez-Ruiz', 'ana.new@x.example', 'Harbor'],
      ['Dee', 'New', 'dee@x.example', null],
    ]);

    const job = await db.withTenant({ tenantId }, (tx) =>
      tx.importJob.findUniqueOrThrow({ where: { id } }),
    );
    expect(job.errorReportKey).toBe(`${tenantId}/imports/${id}-errors.csv`);
    const report = await new Response(
      (await storage.stream(job.errorReportKey!)) as unknown as ReadableStream,
    ).text();
    const lines = report.trim().split('\n');
    expect(lines[0]).toBe('Line,first,last,email,phone,brokerage,tags,id,Errors');
    expect(lines[1]).toMatch(/^4,Cy,Bad,not-an-email,.*Invalid email/);
    expect(lines[2]).toMatch(/^5,No,Key,.*needs an email, an external ID/);
  });

  it('imports brokerages idempotently by name', async () => {
    const tenantId = await tenant();
    const csv = ['Name,City', 'Compass,Austin', 'Keller Williams,Dallas'].join('\n');
    const m = { name: 'Name', city: 'City' };
    expect(await run(tenantId, await importJob(tenantId, 'brokerages', csv, m))).toMatchObject({
      created: 2,
      updated: 0,
    });
    expect(
      await run(
        tenantId,
        await importJob(tenantId, 'brokerages', csv.replace('Austin', 'Houston'), m),
      ),
    ).toMatchObject({ created: 0, updated: 2 });
    const rows = await db.withTenant({ tenantId }, (tx) =>
      tx.brokerage.findMany({ orderBy: { name: 'asc' } }),
    );
    expect(rows.map((b) => [b.name, b.city])).toEqual([
      ['Compass', 'Houston'],
      ['Keller Williams', 'Dallas'],
    ]);
  });

  it('marks the job failed when the file is unreadable', async () => {
    const tenantId = await tenant();
    const id = uuidv7();
    await db.withTenant({ tenantId }, (tx) =>
      tx.importJob.create({
        data: {
          id,
          tenantId,
          entity: 'clients',
          fileKey: `${tenantId}/imports/missing.csv`,
          fileName: 'x.csv',
          fileSize: 1,
          status: 'queued',
          mapping: MAPPING,
        },
      }),
    );
    await expect(run(tenantId, id)).rejects.toThrow();
    const job = await db.withTenant({ tenantId }, (tx) =>
      tx.importJob.findUniqueOrThrow({ where: { id } }),
    );
    expect(job.status).toBe('failed');
    expect(job.lastError).toBeTruthy();
  });
});

describe('export job', () => {
  it('streams a CSV of clients to storage', async () => {
    const tenantId = await tenant();
    await run(tenantId, await importJob(tenantId, 'clients', bigCsv(1500), MAPPING));
    const id = uuidv7();
    await db.withTenant({ tenantId }, (tx) =>
      tx.exportJob.create({ data: { id, tenantId, entity: 'clients' } }),
    );
    const r = await new ExportProcessor(db, storage, log).process({
      data: { tenantId, exportId: id, entity: 'clients', filters: {} },
    } as unknown as Job);
    expect(r).toEqual({ rows: 1500 });
    const job = await db.withTenant({ tenantId }, (tx) =>
      tx.exportJob.findUniqueOrThrow({ where: { id } }),
    );
    expect(job).toMatchObject({
      status: 'completed',
      rowCount: 1500,
      fileKey: `${tenantId}/exports/${id}.csv`,
    });
    const csv = await new Response(
      (await storage.stream(job.fileKey!)) as unknown as ReadableStream,
    ).text();
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(1501);
    expect(lines[0]).toBe(
      'id,first_name,last_name,email,phone,company,title,brokerage,tags,price_list,status,external_id,address,city,region,postal_code,created_at',
    );
    expect(lines[1]).toContain('@bulk.example');
  });
});
