import type { DomainEventName, OutboxEventMessage } from '@tuello/shared';
import type { Job } from 'bullmq';
import type { Log } from '../infra/logger';

export type EventHandler = (event: OutboxEventMessage) => Promise<void>;

/**
 * Consumes published domain events. Modules register handlers by event name; handlers must be
 * idempotent (an event can be delivered more than once). Outgoing webhooks (phase 9) hook in here.
 */
export class EventsProcessor {
  private readonly handlers = new Map<DomainEventName, EventHandler[]>();

  constructor(private readonly log: Log) {}

  on(name: DomainEventName, handler: EventHandler) {
    this.handlers.set(name, [...(this.handlers.get(name) ?? []), handler]);
  }

  process = async (job: Job<OutboxEventMessage>) => {
    const event = job.data;
    const handlers = this.handlers.get(event.name) ?? [];
    for (const h of handlers) await h(event);
    this.log.debug(
      { eventId: event.id, name: event.name, tenantId: event.tenantId, handlers: handlers.length },
      'event processed',
    );
    return { handled: handlers.length };
  };
}
