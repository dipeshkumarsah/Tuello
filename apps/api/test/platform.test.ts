import { CSRF_COOKIE, CSRF_HEADER } from '@tuello/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APEX, Browser, hostFor, signupTenant, startApp, type Harness } from './helpers';

let h: Harness;
beforeAll(async () => {
  h = await startApp();
});
afterAll(async () => {
  await h?.close();
});

describe('health', () => {
  it('answers liveness and readiness on any host', async () => {
    expect((await request(h.server).get('/healthz')).body).toEqual({ status: 'ok' });
    const ready = await request(h.server).get('/readyz').set('Host', 'whatever.example.com');
    expect(ready.body).toEqual({ status: 'ok', checks: { database: 'ok', valkey: 'ok' } });
  });

  it('propagates or assigns a request id', async () => {
    const res = await request(h.server).get('/healthz').set('x-request-id', 'trace-abc-123');
    expect(res.headers['x-request-id']).toBe('trace-abc-123');
    expect((await request(h.server).get('/healthz')).headers['x-request-id']).toMatch(
      /^[0-9a-f-]{36}$/,
    );
  });
});

describe('OpenAPI', () => {
  it('is generated from code and documents permissions', async () => {
    const res = await request(h.server).get('/v1/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toMatch(/^3\./);
    expect(res.body.paths['/v1/members']).toBeTruthy();
    expect(res.body.paths['/v1/members'].get['x-permission']).toBe('members.read');
    expect(res.body.paths['/v1/auth/signup'].post.requestBody).toBeTruthy();
  });
});

describe('CSRF', () => {
  it('rejects state-changing requests without the double-submit token', async () => {
    const { slug, owner } = await signupTenant(h);
    const session = owner.cookies.get('tuello_session')!;
    const res = await request(h.server)
      .patch('/v1/tenant')
      .set('X-Forwarded-Host', hostFor(slug))
      .set('Cookie', `tuello_session=${session}`)
      .send({ name: 'Hijacked' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('csrf_failed');

    const mismatched = await request(h.server)
      .patch('/v1/tenant')
      .set('X-Forwarded-Host', hostFor(slug))
      .set('Cookie', `tuello_session=${session}; ${CSRF_COOKIE}=aaa`)
      .set(CSRF_HEADER, 'bbb')
      .send({ name: 'Hijacked' });
    expect(mismatched.body.code).toBe('csrf_failed');
  });

  it('rejects a foreign Origin even with matching tokens', async () => {
    const { owner } = await signupTenant(h);
    const res = await owner.send(
      'patch',
      '/v1/tenant',
      { name: 'Hijacked' },
      { Origin: 'https://evil.example.com' },
    );
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('csrf_failed');
    const same = await owner.send(
      'patch',
      '/v1/tenant',
      { name: 'Fine Name' },
      { Origin: `http://${owner.host}` },
    );
    expect(same.status).toBe(200);
  });

  it('protects login against CSRF too', async () => {
    const { slug, email } = await signupTenant(h);
    const res = await request(h.server)
      .post('/v1/auth/login')
      .set('X-Forwarded-Host', hostFor(slug))
      .send({ email, password: 'x' });
    expect(res.body.code).toBe('csrf_failed');
  });
});

describe('host scope', () => {
  it('unknown tenant hosts 404 on tenant routes; apex-only routes 404 on tenant hosts', async () => {
    expect(
      (await new Browser(h.server, hostFor('ghost-company')).get('/v1/tenant/public')).body.code,
    ).toBe('tenant_not_found');
    expect((await new Browser(h.server, APEX).get('/v1/tenant/public')).body.code).toBe(
      'tenant_not_found',
    );
    const { slug } = await signupTenant(h);
    expect(
      (await new Browser(h.server, hostFor(slug)).get('/v1/auth/slug-availability?slug=abc'))
        .status,
    ).toBe(404);
  });

  it('returns problem JSON for unknown routes', async () => {
    const res = await request(h.server).get('/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });
});
