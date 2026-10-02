import { DEFAULT_JOB_OPTIONS, QUEUES, type DeadLetterJob, type QueueName } from '@tuello/shared';
import { Queue, Worker, type Job, type Processor } from 'bullmq';
import Redis from 'ioredis';
import type { Log } from './logger';

/**
 * Builds BullMQ workers with the shared policy: exponential retries (from DEFAULT_JOB_OPTIONS on
 * the producer side) and, after the last attempt, a copy in the dead-letter queue indexed per
 * tenant so the owner's "Failed jobs" page can show and retry it.
 */
export class QueueRunner {
  private readonly workers: Worker[] = [];
  private readonly queues = new Map<string, Queue>();
  private readonly connections: Redis[] = [];

  constructor(
    private readonly redisUrl: string,
    private readonly log: Log,
  ) {}

  connection(): Redis {
    const c = new Redis(this.redisUrl, { maxRetriesPerRequest: null });
    this.connections.push(c);
    return c;
  }

  queue(name: QueueName): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, {
        connection: this.connection(),
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      });
      this.queues.set(name, q);
    }
    return q;
  }

  run<T>(name: QueueName, processor: Processor<T>, concurrency: number): Worker<T> {
    const worker = new Worker<T>(name, processor, { connection: this.connection(), concurrency });
    worker.on('failed', (job, err) => void this.onFailed(name, job, err));
    worker.on('error', (err) => this.log.error({ err, queue: name }, 'worker error'));
    this.workers.push(worker as Worker);
    return worker;
  }

  private async onFailed(queue: QueueName, job: Job | undefined, err: Error) {
    if (!job) return;
    const attempts = job.opts.attempts ?? 1;
    const final = job.attemptsMade >= attempts;
    this.log.warn(
      {
        queue,
        jobId: job.id,
        name: job.name,
        attempt: job.attemptsMade,
        attempts,
        final,
        reason: err.message,
      },
      'job failed',
    );
    if (!final) return;
    const tenantId = (job.data as { tenantId?: string } | undefined)?.tenantId ?? null;
    const dead: DeadLetterJob = {
      tenantId,
      originalQueue: queue,
      originalJobId: String(job.id),
      name: job.name,
      data: job.data,
      failedReason: err.message.slice(0, 500),
      attemptsMade: job.attemptsMade,
      failedAt: new Date().toISOString(),
    };
    const id = `${queue}-${job.id}`;
    await this.queue(QUEUES.deadLetter).add(job.name, dead, {
      jobId: id,
      attempts: 1,
      removeOnComplete: false,
      removeOnFail: false,
    });
    const index = this.connections[0] ?? this.connection();
    await index.zadd(tenantId ? `dlq:tenant:${tenantId}` : 'dlq:platform', Date.now(), id);
  }

  async close() {
    await Promise.all(this.workers.map((w) => w.close()));
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    for (const c of this.connections) c.disconnect();
  }
}
