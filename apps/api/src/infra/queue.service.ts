import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { Database } from '@tuello/db';
import {
  DEFAULT_JOB_OPTIONS,
  QUEUES,
  type DeadLetterJob,
  type QueueName,
  type SendEmailJob,
  type VerifyDomainJob,
} from '@tuello/shared';
import { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { DB, REDIS } from './tokens';

/** Producer side of BullMQ. Consumers live in apps/worker. */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly queues = new Map<QueueName, Queue>();

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(DB) private readonly db: Database,
  ) {}

  queue(name: QueueName): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: this.redis, defaultJobOptions: DEFAULT_JOB_OPTIONS });
      this.queues.set(name, q);
    }
    return q;
  }

  /**
   * Enqueue after the current tenant transaction commits (or now, if none is open), so a job
   * never refers to data that was rolled back.
   */
  private later(fn: () => Promise<unknown>): void {
    const run = () =>
      fn().catch((err: unknown) => {
        this.logger.error({ msg: 'enqueue failed', err });
      });
    if (this.db.context()) this.db.afterCommit(run);
    else void run();
  }

  sendEmail(job: SendEmailJob): void {
    this.later(() => this.queue(QUEUES.email).add(job.template, job));
  }

  verifyDomain(job: VerifyDomainJob): void {
    this.later(() =>
      this.queue(QUEUES.domains).add('verify-domain', job, {
        jobId: `verify-${job.domainId}-${Date.now()}`,
      }),
    );
  }

  async listDeadLetters(tenantId: string, start = 0, end = 99) {
    const ids = await this.redis.zrevrange(`dlq:tenant:${tenantId}`, start, end);
    const q = this.queue(QUEUES.deadLetter);
    const jobs = await Promise.all(ids.map((id) => q.getJob(id)));
    return jobs
      .filter(
        (j): j is NonNullable<typeof j> => !!j && (j.data as DeadLetterJob).tenantId === tenantId,
      )
      .map((j) => ({ id: j.id!, data: j.data as DeadLetterJob }));
  }

  async retryDeadLetter(tenantId: string, id: string): Promise<boolean> {
    const q = this.queue(QUEUES.deadLetter);
    const job = await q.getJob(id);
    const data = job?.data as DeadLetterJob | undefined;
    if (!job || !data || data.tenantId !== tenantId) return false;
    await this.queue(data.originalQueue).add(data.name, data.data);
    await job.remove();
    await this.redis.zrem(`dlq:tenant:${tenantId}`, id);
    return true;
  }

  async onModuleDestroy() {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}
