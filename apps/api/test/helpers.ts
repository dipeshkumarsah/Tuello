import type { NestExpressApplication } from '@nestjs/platform-express';
import { createDatabase, hashPassword, uuidv7, type Database } from '@tuello/db';
import { CSRF_COOKIE, CSRF_HEADER, QUEUES, type Role, type SendEmailJob } from '@tuello/shared';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import request, { type Response } from 'supertest';
import { inject } from 'vitest';

export const BASE = 'tuello.test';
export const APEX = `app.${BASE}`;
export const PASSWORD = 'correct horse battery staple';

export interface Harness {
  app: NestExpressApplication;
  server: Server;
  db: Database;
  redis: Redis;
  emails: Queue;
  close(): Promise<void>;
}

/** Boots the real Nest app against the shared containers. Env must be set before importing app code. */
export async function startApp(): Promise<Harness> {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: inject('appDbUrl'),
    VALKEY_URL: inject('valkeyUrl'),
    APP_BASE_DOMAIN: BASE,
    APP_PUBLIC_PROTOCOL: 'http',
    COOKIE_SECURE: 'false',
    TRUST_PROXY: 'true',
    ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    RATE_LIMIT_FACTOR: '1000',
    S3_ENDPOINT: inject('s3Endpoint'),
    S3_ACCESS_KEY_ID: 'tuello',
    S3_SECRET_ACCESS_KEY: 'tuello-dev-secret',
    S3_BUCKET: 'tuello',
    S3_REGION: 'us-east-1',
    S3_FORCE_PATH_STYLE: 'true',
  });
  const { createApp } = await import('../src/bootstrap');
  const app = await createApp({ logger: false });
  await app.init();
  const redis = new Redis(inject('valkeyUrl'), { maxRetriesPerRequest: null });
  const emails = new Queue(QUEUES.email, { connection: redis });
  const db = createDatabase({ url: inject('appDbUrl') });
  return {
    app,
    server: app.getHttpServer(),
    db,
    redis,
    emails,
    close: async () => {
      await emails.close();
      redis.disconnect();
      await db.disconnect();
      await app.close();
    },
  };
}

/** A browser on one host: keeps its own cookies and sends CSRF headers like the web app does. */
export class Browser {
  readonly cookies = new Map<string, string>();
  constructor(
    private readonly server: Server,
    public host: string,
  ) {}

  private apply(res: Response) {
    const set = res.headers['set-cookie'] as unknown as string[] | undefined;
    for (const c of set ?? []) {
      const [pair, ...attrs] = c.split(';');
      const [name, ...rest] = pair!.split('=');
      const value = rest.join('=');
      const expired = attrs.some((a) => /expires=thu, 01 jan 1970/i.test(a.trim()));
      if (!value || expired) this.cookies.delete(name!.trim());
      else this.cookies.set(name!.trim(), value);
    }
    return res;
  }

  async send(
    method: 'get' | 'post' | 'patch' | 'delete' | 'put',
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    if (method !== 'get' && !this.cookies.has(CSRF_COOKIE)) {
      this.apply(
        await request(this.server).get('/v1/auth/csrf').set('X-Forwarded-Host', this.host),
      );
    }
    let r = request(this.server)[method](path).set('X-Forwarded-Host', this.host);
    if (this.cookies.size)
      r = r.set('Cookie', [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '));
    if (method !== 'get') r = r.set(CSRF_HEADER, this.cookies.get(CSRF_COOKIE) ?? '');
    for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
    if (body !== undefined) r = r.send(body as object);
    return this.apply(await r);
  }

  get = (p: string) => this.send('get', p);
  post = (p: string, b?: unknown) => this.send('post', p, b ?? {});
  patch = (p: string, b?: unknown) => this.send('patch', p, b ?? {});
  del = (p: string) => this.send('delete', p);
}

export const hostFor = (slug: string) => `${slug}.${BASE}`;

/** Most recent queued email to an address (the worker is not running in API tests). */
export async function lastEmail(
  h: Harness,
  to: string,
  template?: SendEmailJob['template'],
): Promise<SendEmailJob> {
  const jobs = await h.emails.getJobs([
    'waiting',
    'delayed',
    'active',
    'completed',
    'failed',
    'prioritized',
  ]);
  const match = jobs
    .filter(
      (j) =>
        (j.data as SendEmailJob).to === to &&
        (!template || (j.data as SendEmailJob).template === template),
    )
    .sort((a, b) => b.timestamp - a.timestamp)[0];
  if (!match) throw new Error(`No ${template ?? ''} email to ${to}`);
  return match.data as SendEmailJob;
}

export function tokenFrom(link: string): string {
  const u = new URL(link);
  return u.searchParams.get('token') ?? u.pathname.split('/').pop()!;
}

let n = 0;
export function uniqueSlug(prefix = 't'): string {
  n += 1;
  return `${prefix}${Date.now().toString(36)}${n}`.slice(0, 30);
}

/** Signs up a company through the API and verifies the owner's email. Returns a signed-in browser. */
export async function signupTenant(h: Harness, slug = uniqueSlug()) {
  const apex = new Browser(h.server, APEX);
  const email = `owner@${slug}.example.com`;
  const res = await apex.post('/v1/auth/signup', {
    companyName: `${slug} Media`,
    slug,
    name: 'Olive Owner',
    email,
    password: PASSWORD,
  });
  if (res.status !== 201)
    throw new Error(`signup failed ${res.status} ${JSON.stringify(res.body)}`);
  await waitForEmail(h, email, 'verify_email');
  const mail = await lastEmail(h, email, 'verify_email');
  const owner = new Browser(h.server, hostFor(slug));
  const v = await owner.post('/v1/auth/verify-email', { token: tokenFrom(mail.vars.link!) });
  if (v.status !== 200) throw new Error(`verify failed ${v.status} ${JSON.stringify(v.body)}`);
  const tenant = await h.db.system.tenantBySlug(slug);
  return { slug, email, owner, tenantId: tenant!.id };
}

export async function waitForEmail(h: Harness, to: string, template?: SendEmailJob['template']) {
  for (let i = 0; i < 50; i++) {
    try {
      return await lastEmail(h, to, template);
    } catch {
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  return lastEmail(h, to, template);
}

/** Adds a verified member with a password directly through the RLS-restricted DB layer. */
export async function addMember(h: Harness, tenantId: string, role: Role, slug: string) {
  const userId = uuidv7();
  const email = `${role.replace('_', '-')}-${userId.slice(-6)}@${slug}.example.com`;
  const passwordHash = await hashPassword(PASSWORD);
  await h.db.withTenant({ tenantId, userId }, async (tx) => {
    await tx.user.create({
      data: {
        id: userId,
        email,
        name: `${role} person`,
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    await tx.membership.create({ data: { tenantId, userId, role } });
  });
  return { userId, email };
}

export async function loginAs(h: Harness, slug: string, email: string, password = PASSWORD) {
  const b = new Browser(h.server, hostFor(slug));
  const res = await b.post('/v1/auth/login', { email, password });
  if (res.status !== 200) throw new Error(`login failed ${res.status} ${JSON.stringify(res.body)}`);
  return b;
}
