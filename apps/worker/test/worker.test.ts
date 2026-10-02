import { createDatabase, uuidv7, type Database } from '@tuello/db';
import {
  createTlsProvisioner,
  QUEUES,
  type DeadLetterJob,
  type SendEmailJob,
} from '@tuello/shared';
import { Queue, type Job } from 'bullmq';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { loadEnv, type WorkerEnv } from '../src/config';
import { DnsResolver } from '../src/infra/dns';
import { createLogger } from '../src/infra/logger';
import { SmtpMailer } from '../src/infra/mailer';
import { QueueRunner } from '../src/infra/queue-runner';
import { Storage } from '../src/infra/storage';
import { DomainProcessor } from '../src/jobs/domain.processor';
import { EmailProcessor } from '../src/jobs/email.processor';
import { OutboxPublisher } from '../src/jobs/outbox.publisher';

class FakeDns extends DnsResolver {
  txt = new Map<string, string[][]>();
  async resolveTxt(name: string) {
    const r = this.txt.get(name);
    if (!r) throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
    return r;
  }
  async resolveCname() {
    return [];
  }
}

const log = createLogger('silent', false);
let env: WorkerEnv;
let db: Database;
let redis: Redis;

async function makeTenant(
  name: string,
  branding?: { emailSenderName?: string; accentColor?: string },
) {
  const tenantId = uuidv7();
  await db.withTenant({ tenantId }, async (tx) => {
    await tx.tenant.create({ data: { id: tenantId, slug: `w${tenantId.slice(-10)}`, name } });
    await tx.tenantBranding.create({ data: { tenantId, ...branding } });
  });
  return tenantId;
}

beforeAll(() => {
  env = loadEnv({
    DATABASE_URL: inject('appDbUrl'),
    VALKEY_URL: inject('valkeyUrl'),
    SMTP_URL: inject('smtpUrl'),
    EMAIL_FROM_ADDRESS: 'mail@studio-mail.test',
    DOMAIN_MAX_CHECKS: '3',
  } as NodeJS.ProcessEnv);
  db = createDatabase({ url: env.DATABASE_URL });
  redis = new Redis(env.VALKEY_URL, { maxRetriesPerRequest: null });
});

afterAll(async () => {
  redis?.disconnect();
  await db?.disconnect();
});

describe('email job', () => {
  it('delivers a tenant-branded email over SMTP, once', async () => {
    const tenantId = await makeTenant('Northlight Media', {
      emailSenderName: 'Northlight Studio',
      accentColor: '#1D3557',
    });
    const mailer = new SmtpMailer(env.SMTP_URL);
    const p = new EmailProcessor(db, redis, mailer, new Storage(env), env, log);
    const job = {
      id: `test-${uuidv7()}`,
      data: {
        tenantId,
        template: 'invite',
        to: 'newbie@example.com',
        locale: 'en',
        vars: { inviter: 'Olive', role: 'Editor', link: 'http://north.tuello.test/invite/abc' },
      } satisfies SendEmailJob,
    } as unknown as Job<SendEmailJob>;
    await p.process(job);
    expect(await p.process(job)).toEqual({ skipped: 'already-sent' });
    mailer.close();

    const list = (await (await fetch(`${inject('mailpitUrl')}/api/v1/messages`)).json()) as {
      messages: Array<{
        ID: string;
        From: { Name: string; Address: string };
        To: Array<{ Address: string }>;
        Subject: string;
      }>;
    };
    const mine = list.messages.filter((m) => m.To[0]?.Address === 'newbie@example.com');
    expect(mine).toHaveLength(1);
    expect(mine[0]!.From).toEqual({ Name: 'Northlight Studio', Address: 'mail@studio-mail.test' });
    expect(mine[0]!.Subject).toBe('Olive invited you to Northlight Media');
    const full = (await (
      await fetch(`${inject('mailpitUrl')}/api/v1/message/${mine[0]!.ID}`)
    ).json()) as { HTML: string; Text: string };
    expect(full.HTML).toContain('background:#1D3557');
    expect(`${full.HTML}${full.Text}`.toLowerCase()).not.toContain('tuello.app');
  });
});

describe('outbox publisher', () => {
  it('relays events from every tenant once, keyed by event id', async () => {
    const t1 = await makeTenant('One');
    const t2 = await makeTenant('Two');
    for (const t of [t1, t2]) {
      await db.withTenant({ tenantId: t }, (tx) =>
        tx.outboxEvent.create({
          data: { tenantId: t, name: 'tenant.updated', aggregateType: 'tenant', aggregateId: t },
        }),
      );
    }
    const events = new Queue(`${QUEUES.events}-test`, { connection: redis });
    const pub = new OutboxPublisher(db, events, log, 100);
    expect(await pub.publishOnce()).toBeGreaterThanOrEqual(2);
    expect(await pub.publishOnce()).toBe(0);
    const jobs = await events.getJobs(['waiting']);
    const tenants = jobs.map((j) => (j.data as { tenantId: string }).tenantId);
    expect(tenants).toEqual(expect.arrayContaining([t1, t2]));
    for (const j of jobs) expect(j.id).toBe((j.data as { id: string }).id);
    const unpublished = await db.withTenant({ tenantId: t1 }, (tx) =>
      tx.outboxEvent.count({ where: { publishedAt: null } }),
    );
    expect(unpublished).toBe(0);
    await events.obliterate({ force: true });
    await events.close();
  });
});

describe('domain verification', () => {
  async function addDomain(tenantId: string, hostname: string) {
    return db.withTenant({ tenantId }, (tx) =>
      tx.tenantDomain.create({ data: { tenantId, hostname, verificationToken: 'abc123' } }),
    );
  }

  it('verifies when the TXT record matches, emits an event, and invalidates the host cache', async () => {
    const tenantId = await makeTenant('Dns Co');
    const d = await addDomain(tenantId, 'photos.dnsco.example');
    const dns = new FakeDns();
    dns.txt.set('_tuello-verify.photos.dnsco.example', [['tuello-verify=', 'abc123']]);
    await redis.set('tenant:domain:photos.dnsco.example', 'null');
    const p = new DomainProcessor(
      db,
      redis,
      dns,
      createTlsProvisioner({ TLS_PROVISIONER: 'noop' }),
      env,
      log,
    );
    const out = await p.verify({ data: { tenantId, domainId: d.id } } as unknown as Job);
    expect(out.status).toBe('verified');
    expect(await redis.exists('tenant:domain:photos.dnsco.example')).toBe(0);
    expect((await db.system.tenantByDomain('photos.dnsco.example'))?.id).toBe(tenantId);
    const evt = await db.withTenant({ tenantId }, (tx) =>
      tx.outboxEvent.findFirst({ where: { name: 'domain.verified' } }),
    );
    expect(evt?.aggregateId).toBe(d.id);
  });

  it('stays pending with an error, then fails after DOMAIN_MAX_CHECKS', async () => {
    const tenantId = await makeTenant('Slow Dns');
    const d = await addDomain(tenantId, 'photos.slow.example');
    const dns = new FakeDns();
    dns.txt.set('_tuello-verify.photos.slow.example', [['tuello-verify=wrong']]);
    const p = new DomainProcessor(
      db,
      redis,
      dns,
      createTlsProvisioner({ TLS_PROVISIONER: 'noop' }),
      env,
      log,
    );
    const job = { data: { tenantId, domainId: d.id } } as unknown as Job;
    expect((await p.verify(job)).status).toBe('pending');
    const row = await db.withTenant({ tenantId }, (tx) =>
      tx.tenantDomain.findUniqueOrThrow({ where: { id: d.id } }),
    );
    expect(row.lastError).toMatch(/different value/);
    expect((await p.verify(job)).status).toBe('pending');
    expect((await p.verify(job)).status).toBe('failed');
  });

  it('scan queues checks for due domains across tenants', async () => {
    const q = new Queue(`${QUEUES.domains}-scan-test`, { connection: redis });
    const p = new DomainProcessor(
      db,
      redis,
      new FakeDns(),
      createTlsProvisioner({ TLS_PROVISIONER: 'noop' }),
      env,
      log,
    );
    const t = await makeTenant('Scan Co');
    await addDomain(t, 'photos.scan.example');
    const res = await p.scan({} as unknown as Job, q);
    expect(res.queued).toBeGreaterThanOrEqual(1);
    await q.obliterate({ force: true });
    await q.close();
  });
});

describe('retries and dead-letter queue', () => {
  it('moves a job to the DLQ after its last attempt, indexed by tenant', async () => {
    const runner = new QueueRunner(env.VALKEY_URL, log);
    const tenantId = uuidv7();
    const name = 'email' as const;
    let calls = 0;
    // Run against the real queue name so the DLQ entry looks exactly like production.
    const queue = runner.queue(name);
    await queue.obliterate({ force: true });
    runner.run(
      name,
      async () => {
        calls += 1;
        throw new Error('SMTP 554 rejected');
      },
      1,
    );
    await queue.add(
      'verify_email',
      { tenantId, to: 'x@y.z' },
      { attempts: 3, backoff: { type: 'exponential', delay: 10 } },
    );
    for (let i = 0; i < 100 && (await redis.zcard(`dlq:tenant:${tenantId}`)) === 0; i++)
      await new Promise((r) => setTimeout(r, 50));
    expect(calls).toBe(3);
    const ids = await redis.zrange(`dlq:tenant:${tenantId}`, 0, -1);
    expect(ids).toHaveLength(1);
    const dlq = runner.queue(QUEUES.deadLetter);
    const dead = (await dlq.getJob(ids[0]!))!.data as DeadLetterJob;
    expect(dead).toMatchObject({
      tenantId,
      originalQueue: 'email',
      name: 'verify_email',
      attemptsMade: 3,
      failedReason: 'SMTP 554 rejected',
    });
    await runner.close();
  });
});
