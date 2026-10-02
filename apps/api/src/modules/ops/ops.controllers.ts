import { Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Database } from '@tuello/db';
import {
  cursorPageQuerySchema,
  type AuditLogDto,
  type CursorPage,
  type CursorPageQuery,
  type DeadLetterJobDto,
} from '@tuello/shared';
import type Redis from 'ioredis';
import { z } from 'zod';
import {
  HostScoped,
  NoTenantTransaction,
  Public,
  RateLimit,
  RequirePermission,
} from '../../common/decorators';
import { afterCursorDesc, decodeCursor, toPage } from '../../common/pagination';
import { Problem } from '../../common/problem';
import type { TuelloRequest } from '../../common/request';
import { ApiZodQuery, ZodPipe, ZQuery } from '../../common/zod';
import { QueueService } from '../../infra/queue.service';
import { DB, REDIS } from '../../infra/tokens';

/** Liveness and readiness. Unversioned, any host, no rate limit. */
@ApiTags('health')
@Controller()
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get('healthz')
  @Public()
  @HostScoped('any')
  @NoTenantTransaction()
  @RateLimit()
  healthz() {
    return { status: 'ok' };
  }

  @Get('readyz')
  @Public()
  @HostScoped('any')
  @NoTenantTransaction()
  @RateLimit()
  async readyz() {
    const checks: Record<string, 'ok' | 'fail'> = {};
    await Promise.all([
      this.db.system.ping().then(
        () => (checks.database = 'ok'),
        () => (checks.database = 'fail'),
      ),
      this.redis.ping().then(
        () => (checks.valkey = 'ok'),
        () => (checks.valkey = 'fail'),
      ),
    ]);
    if (Object.values(checks).includes('fail'))
      throw new Problem('internal_error', JSON.stringify(checks));
    return { status: 'ok', checks };
  }
}

@ApiTags('jobs')
@Controller({ path: 'jobs/dead-letter', version: '1' })
export class DeadLetterController {
  constructor(private readonly queues: QueueService) {}

  /** Jobs of THIS tenant that failed every retry. */
  @Get()
  @RequirePermission('jobs.read')
  async list(@Req() req: TuelloRequest): Promise<{ items: DeadLetterJobDto[] }> {
    const jobs = await this.queues.listDeadLetters(req.tenant!.id);
    return {
      items: jobs.map((j) => ({
        id: j.id,
        queue: j.data.originalQueue,
        name: j.data.name,
        failedReason: j.data.failedReason,
        attemptsMade: j.data.attemptsMade,
        failedAt: j.data.failedAt,
      })),
    };
  }

  @Post(':id/retry')
  @HttpCode(202)
  @RequirePermission('jobs.retry')
  async retry(
    @Param('id', new ZodPipe(z.string().min(1).max(200))) id: string,
    @Req() req: TuelloRequest,
  ) {
    if (!(await this.queues.retryDeadLetter(req.tenant!.id, id))) throw new Problem('not_found');
    return { status: 'queued' };
  }
}

@ApiTags('audit')
@Controller({ path: 'audit-logs', version: '1' })
export class AuditLogController {
  constructor(@Inject(DB) private readonly db: Database) {}

  @Get()
  @RequirePermission('audit.read')
  @ApiZodQuery(cursorPageQuerySchema)
  async list(@ZQuery(cursorPageQuerySchema) q: CursorPageQuery): Promise<CursorPage<AuditLogDto>> {
    const rows = await this.db.tx.auditLog.findMany({
      where: afterCursorDesc(decodeCursor(q.cursor)),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      include: { actor: { select: { id: true, name: true } } },
    });
    return toPage(rows, q.limit, (r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      actor: r.actor,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
