import { QUEUES } from '@tuello/shared';
import { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, loginAs, signupTenant, startApp, type Browser, type Harness } from './helpers';

let h: Harness;
let A: Awaited<ReturnType<typeof signupTenant>>;
let coord: Browser;

beforeAll(async () => {
  h = await startApp();
  A = await signupTenant(h);
  coord = await loginAs(h, A.slug, (await addMember(h, A.tenantId, 'coordinator', A.slug)).email);
});
afterAll(async () => {
  await h?.close();
});

/** Uploads like the browser does: multipart POST straight to object storage. */
async function upload(target: { url: string; fields: Record<string, string> }, csv: string) {
  const form = new FormData();
  for (const [k, val] of Object.entries(target.fields)) form.append(k, val);
  form.append('file', new Blob([csv], { type: 'text/csv' }), 'clients.csv');
  const r = await fetch(target.url, { method: 'POST', body: form });
  expect(r.status).toBeLessThan(300);
}

const CSV = [
  'First Name,Last Name,E-mail,Mobile,Brokerage,Tags',
  'Ana,Lopez,ana@x.example,512 555 0100,Harbor Realty,"vip, luxury"',
  'Bad,Row,not-an-email,,,',
  ',,,,,',
].join('\n');

describe('CSV import (API side)', () => {
  it('creates a job with a tenant-scoped presigned upload, previews with a suggested mapping, and queues the job', async () => {
    const created = await coord.post('/v1/imports', {
      entity: 'clients',
      fileName: 'clients.csv',
      size: CSV.length,
    });
    expect(created.status).toBe(201);
    expect(created.body.import).toMatchObject({ status: 'awaiting_upload', entity: 'clients' });
    expect(created.body.upload.fields.key).toBe(
      `${A.tenantId}/imports/${created.body.import.id}.csv`,
    );
    const id = created.body.import.id as string;

    expect((await coord.post(`/v1/imports/${id}/preview`, {})).body.detail).toMatch(
      /not been uploaded/,
    );
    await upload(created.body.upload, CSV);

    const preview = await coord.post(`/v1/imports/${id}/preview`, {});
    expect(preview.status).toBe(200);
    expect(preview.body.headers).toEqual([
      'First Name',
      'Last Name',
      'E-mail',
      'Mobile',
      'Brokerage',
      'Tags',
    ]);
    expect(preview.body.suggestedMapping).toEqual({
      firstName: 'First Name',
      lastName: 'Last Name',
      email: 'E-mail',
      phone: 'Mobile',
      brokerage: 'Brokerage',
      tags: 'Tags',
    });
    expect(preview.body.rows.map((r: { line: number; ok: boolean }) => [r.line, r.ok])).toEqual([
      [2, true],
      [3, false],
    ]);

    expect(
      (
        await coord.post(`/v1/imports/${id}/start`, {
          mapping: { firstName: 'First Name', bogus: 'x' },
        })
      ).status,
    ).toBe(422);
    expect(
      (await coord.post(`/v1/imports/${id}/start`, { mapping: { firstName: 'First Name' } })).body
        .detail,
    ).toMatch(/email, external ID or phone/);
    const started = await coord.post(`/v1/imports/${id}/start`, {
      mapping: preview.body.suggestedMapping,
    });
    expect(started.status).toBe(202);
    expect(started.body.status).toBe('queued');
    expect(
      (await coord.post(`/v1/imports/${id}/start`, { mapping: preview.body.suggestedMapping }))
        .status,
    ).toBe(409);

    const queue = new Queue(QUEUES.imports, { connection: h.redis });
    await new Promise((r) => setTimeout(r, 50));
    const job = await queue.getJob(`import-${id}`);
    expect(job?.data).toEqual({ tenantId: A.tenantId, importId: id, userId: expect.any(String) });
    await queue.close();
    expect((await coord.get('/v1/imports')).body.items[0].id).toBe(id);
  });

  it('is tenant-scoped and needs clients.manage', async () => {
    const B = await signupTenant(h);
    const mine = (
      await coord.post('/v1/imports', { entity: 'brokerages', fileName: 'b.csv', size: 10 })
    ).body.import.id;
    expect((await B.owner.get(`/v1/imports/${mine}`)).status).toBe(404);
    expect(
      (await B.owner.post(`/v1/imports/${mine}/start`, { mapping: { name: 'Name' } })).status,
    ).toBe(404);
    const shooter = await loginAs(
      h,
      A.slug,
      (await addMember(h, A.tenantId, 'shooter', A.slug)).email,
    );
    expect(
      (await shooter.post('/v1/imports', { entity: 'clients', fileName: 'c.csv', size: 10 }))
        .status,
    ).toBe(403);
  });

  it('rejects files that are too large', async () => {
    expect(
      (
        await coord.post('/v1/imports', {
          entity: 'clients',
          fileName: 'big.csv',
          size: 60 * 1024 * 1024,
        })
      ).status,
    ).toBe(422);
  });
});

describe('CSV export (API side)', () => {
  it('queues an export and checks the entity permission on download', async () => {
    const r = await coord.post('/v1/clients/export', { filters: { status: 'active' } });
    expect(r.status).toBe(202);
    const status = await coord.get(`/v1/exports/${r.body.id}`);
    expect(status.body).toMatchObject({ entity: 'clients', status: 'queued', url: null });
    const shooter = await loginAs(
      h,
      A.slug,
      (await addMember(h, A.tenantId, 'shooter', A.slug)).email,
    );
    expect((await shooter.get(`/v1/exports/${r.body.id}`)).status).toBe(404);
    expect((await shooter.post('/v1/coupons/export')).status).toBe(403);
  });
});
