import { expect, test } from '@playwright/test';
import { apiCall, signIn, tenantUrl, unique } from './support';

const ROWS = 5_000;
const P95_LIMIT_MS = Number(process.env.E2E_IMPORT_P95_MS ?? 300);

interface ImportJob {
  id: string;
  status: string;
  processedRows: number;
  createdCount: number;
  updatedCount: number;
  errorCount: number;
}

/**
 * Phase 2 acceptance across real processes: 5,000 clients go through presigned upload → API
 * preview → worker import, while the API keeps answering client-list requests quickly.
 */
test('5,000-client CSV import runs in the background without blocking the API', async ({
  page,
}) => {
  test.setTimeout(180_000);
  // An admin, so this spec does not share the owner's login rate-limit budget.
  await signIn(page, 'acme', 'admin@acme.test');
  const run = unique('load');
  const lines = ['First name,Last name,Email,Phone,Brokerage'];
  for (let i = 0; i < ROWS; i++) {
    lines.push(
      `Load${i},Agent${run},agent${i}@${run}.example.com,+1 212 555 ${String(i).padStart(4, '0')},Harbor Realty`,
    );
  }
  const csv = lines.join('\n');

  const created = await apiCall<{
    import: ImportJob;
    upload: { url: string; fields: Record<string, string> };
  }>(page, 'POST', '/v1/imports', {
    entity: 'clients',
    fileName: `${run}.csv`,
    size: Buffer.byteLength(csv),
  });
  expect(created.status).toBe(201);
  const { id } = created.body.import;

  // Straight to object storage, as the browser does.
  const form = new FormData();
  for (const [k, v] of Object.entries(created.body.upload.fields)) form.append(k, v);
  form.append('file', new Blob([csv], { type: 'text/csv' }), `${run}.csv`);
  const uploaded = await fetch(created.body.upload.url, { method: 'POST', body: form });
  expect(uploaded.ok).toBe(true);

  const preview = await apiCall<{ suggestedMapping: Record<string, string | null> }>(
    page,
    'POST',
    `/v1/imports/${id}/preview`,
    {},
  );
  expect(preview.status).toBe(200);
  const started = await apiCall(page, 'POST', `/v1/imports/${id}/start`, {
    mapping: preview.body.suggestedMapping,
  });
  expect(started.status).toBe(202);

  // While the worker imports, keep using the API and record how long each request takes.
  const timings: number[] = [];
  let job: ImportJob = created.body.import;
  let sawRunning = false;
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    const { status, ms } = await page.evaluate(async () => {
      const t0 = performance.now();
      const res = await fetch('/api/v1/clients?limit=50');
      await res.json();
      return { status: res.status, ms: performance.now() - t0 };
    });
    timings.push(ms);
    expect(status).toBe(200);
    job = (await apiCall<ImportJob>(page, 'GET', `/v1/imports/${id}`)).body;
    if (job.status === 'running') sawRunning = true;
    if (job.status === 'completed' || job.status === 'failed') break;
  }

  expect(job).toMatchObject({
    status: 'completed',
    processedRows: ROWS,
    createdCount: ROWS,
    errorCount: 0,
  });
  expect(sawRunning).toBe(true);
  timings.sort((a, b) => a - b);
  const p95 = timings[Math.floor(timings.length * 0.95)]!;
  test.info().annotations.push({
    type: 'client list during import',
    description: `${timings.length} requests, p95 ${p95.toFixed(0)} ms`,
  });
  expect(timings.length).toBeGreaterThan(10);
  expect(p95).toBeLessThan(P95_LIMIT_MS);

  // The imported clients are searchable.
  await page.goto(tenantUrl('acme', '/clients'));
  await page.getByPlaceholder('Search name, email, phone or brokerage').fill(`agent4999@${run}`);
  await expect(page.getByRole('table').getByText(`Load4999 Agent${run}`)).toBeVisible();
});
