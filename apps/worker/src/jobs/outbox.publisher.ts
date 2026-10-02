import type { Database } from '@tuello/db';
import type { OutboxEventMessage, DomainEventName } from '@tuello/shared';
import type { Queue } from 'bullmq';
import type { Log } from '../infra/logger';

/**
 * Transactional outbox relay. Claims unpublished events with a lease (SKIP LOCKED, so any
 * number of workers can run), enqueues each on the `events` queue with jobId = event id (so a
 * re-publish after a crash is a no-op), then marks them published.
 */
export class OutboxPublisher {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly db: Database,
    private readonly events: Queue,
    private readonly log: Log,
    private readonly batch: number,
  ) {}

  async publishOnce(): Promise<number> {
    const claimed = await this.db.system.claimOutboxEvents(this.batch, 30);
    if (claimed.length === 0) return 0;
    await this.events.addBulk(
      claimed.map((e) => {
        const msg: OutboxEventMessage = {
          id: e.id,
          tenantId: e.tenantId,
          name: e.name as DomainEventName,
          aggregateType: e.aggregateType,
          aggregateId: e.aggregateId,
          payload: (e.payload ?? {}) as Record<string, unknown>,
          occurredAt: e.occurredAt.toISOString(),
        };
        return { name: e.name, data: msg, opts: { jobId: e.id } };
      }),
    );
    await this.db.system.markOutboxPublished(claimed.map((e) => e.id));
    return claimed.length;
  }

  start(intervalMs: number) {
    const tick = async () => {
      if (this.running) return;
      this.running = true;
      try {
        // Drain quickly when there is a backlog.
        while ((await this.publishOnce()) === this.batch) {
          /* keep draining */
        }
      } catch (err) {
        this.log.error({ err }, 'outbox publish failed');
      } finally {
        this.running = false;
      }
    };
    this.timer = setInterval(() => void tick(), intervalMs);
    void tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }
}
