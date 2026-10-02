import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Database } from '@tuello/db';
import { from, lastValueFrom, type Observable } from 'rxjs';
import { DB } from '../infra/tokens';
import { NO_TENANT_TX_KEY } from './decorators';
import type { TuelloRequest } from './request';

/**
 * Runs every handler on a tenant host inside ONE database transaction that starts with
 * SET LOCAL app.tenant_id / app.user_id. Handlers reach it through `db.tx`.
 */
@Injectable()
export class TenantTransactionInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DB) private readonly db: Database,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<TuelloRequest>();
    const skip = this.reflector.getAllAndOverride<boolean>(NO_TENANT_TX_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!req.tenant || skip) return next.handle();
    return from(
      this.db.withTenant({ tenantId: req.tenant.id, userId: req.auth?.userId ?? null }, () =>
        lastValueFrom(next.handle(), { defaultValue: undefined }),
      ),
    );
  }
}
