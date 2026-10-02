import { Inject, Injectable } from '@nestjs/common';
import { MissingTenantContextError, Prisma, type Database } from '@tuello/db';
import type { DomainEventName } from '@tuello/shared';
import { DB } from '../../infra/tokens';
import type { TuelloRequest } from '../../common/request';

/** Strips anything secret-looking before it is persisted in an event or audit payload. */
function scrub(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (/password|token|secret|code|hash/i.test(k)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Domain events through the transactional outbox: written in the same transaction as the
 * change, published by the worker. Names are listed in @tuello/shared DOMAIN_EVENTS.
 */
@Injectable()
export class EventsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async emit(
    name: DomainEventName,
    aggregate: { type: string; id: string | null },
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    const ctx = this.db.context();
    if (!ctx) throw new MissingTenantContextError(`event ${name}`);
    await this.db.tx.outboxEvent.create({
      data: {
        tenantId: ctx.tenantId,
        name,
        aggregateType: aggregate.type,
        aggregateId: aggregate.id,
        payload: scrub(payload) as Prisma.InputJsonValue,
      },
    });
  }
}

/** Who did what to which record. Append-only (the app role cannot update or delete). */
@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async record(
    req: Pick<TuelloRequest, 'id' | 'ip' | 'auth'> | null,
    action: string,
    entity: { type: string; id: string | null },
    data: Record<string, unknown> = {},
    actorUserId?: string | null,
  ): Promise<void> {
    const ctx = this.db.context();
    if (!ctx) throw new MissingTenantContextError(`audit ${action}`);
    await this.db.tx.auditLog.create({
      data: {
        tenantId: ctx.tenantId,
        actorUserId: actorUserId ?? req?.auth?.userId ?? ctx.userId ?? null,
        action,
        entityType: entity.type,
        entityId: entity.id,
        data: scrub(data) as Prisma.InputJsonValue,
        ip: req?.ip ?? null,
        requestId: req?.id ?? null,
      },
    });
  }
}
