import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Database } from '@tuello/db';
import {
  createTlsProvisioner,
  QUEUES,
  type SendEmailJob,
  type VerifyDomainJob,
} from '@tuello/shared';
import { createServer, type Server } from 'node:http';
import { DB, ENV, type WorkerEnv } from './config';
import { DnsResolver } from './infra/dns';
import { LOG, type Log } from './infra/logger';
import { Mailer } from './infra/mailer';
import { QueueRunner } from './infra/queue-runner';
import { Storage } from './infra/storage';
import { DomainProcessor } from './jobs/domain.processor';
import { EmailProcessor } from './jobs/email.processor';
import { EventsProcessor } from './jobs/events.processor';
import { OutboxPublisher } from './jobs/outbox.publisher';

/** Starts every consumer, the outbox relay, the domain scan schedule, and a health endpoint. */
@Injectable()
export class WorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  readonly runner: QueueRunner;
  readonly events: EventsProcessor;
  private outbox?: OutboxPublisher;
  private health?: Server;

  constructor(
    @Inject(ENV) private readonly env: WorkerEnv,
    @Inject(DB) private readonly db: Database,
    @Inject(LOG) private readonly log: Log,
    private readonly mailer: Mailer,
    private readonly dns: DnsResolver,
  ) {
    this.runner = new QueueRunner(env.VALKEY_URL, log);
    this.events = new EventsProcessor(log);
  }

  async onApplicationBootstrap() {
    await this.db.system.assertRuntimeRoleIsRestricted();
    const redis = this.runner.connection();
    const c = this.env.WORKER_CONCURRENCY;

    const email = new EmailProcessor(
      this.db,
      redis,
      this.mailer,
      new Storage(this.env),
      this.env,
      this.log,
    );
    this.runner.run<SendEmailJob>(QUEUES.email, email.process, c);

    const domains = new DomainProcessor(
      this.db,
      redis,
      this.dns,
      createTlsProvisioner(this.env),
      this.env,
      this.log,
    );
    const domainQueue = this.runner.queue(QUEUES.domains);
    this.runner.run<VerifyDomainJob>(
      QUEUES.domains,
      (job) => (job.name === 'scan-pending' ? domains.scan(job, domainQueue) : domains.verify(job)),
      c,
    );
    await domainQueue.upsertJobScheduler(
      'scan-pending',
      { every: this.env.DOMAIN_SCAN_EVERY_MS },
      { name: 'scan-pending', data: {} as never },
    );

    this.runner.run(QUEUES.events, this.events.process, c);

    this.outbox = new OutboxPublisher(
      this.db,
      this.runner.queue(QUEUES.events),
      this.log,
      this.env.OUTBOX_BATCH,
    );
    this.outbox.start(this.env.OUTBOX_POLL_MS);

    this.health = createServer((req, res) => {
      if (req.url !== '/healthz' && req.url !== '/readyz') {
        res.writeHead(404).end();
        return;
      }
      Promise.all([this.db.system.ping(), redis.ping()])
        .then(() =>
          res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}'),
        )
        .catch(() =>
          res.writeHead(503, { 'content-type': 'application/json' }).end('{"status":"fail"}'),
        );
    }).listen(this.env.HEALTH_PORT);
    this.log.info({ queues: Object.values(QUEUES) }, 'worker started');
  }

  async onApplicationShutdown() {
    this.outbox?.stop();
    this.health?.close();
    await this.runner.close();
    this.mailer.close();
    await this.db.disconnect();
  }
}
