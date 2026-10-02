import {
  Inject,
  Injectable,
  Logger,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Database } from '@tuello/db';
import { can, SESSION_COOKIE, type Permission, type Role } from '@tuello/shared';
import type { Response } from 'express';
import { DB } from '../infra/tokens';
import { SessionService } from '../modules/identity/session.service';
import { HOST_SCOPE_KEY, PERMISSION_KEY, PUBLIC_KEY, type HostScope } from './decorators';
import { Problem } from './problem';
import type { TuelloRequest } from './request';

/**
 * Enforces, for every route:
 *  - host scope (tenant host, apex host, or any),
 *  - deny by default: a route without @Public() or @RequirePermission() is a 500, never open,
 *  - session validity, and that the session's tenant equals the host's tenant,
 *  - the permission matrix row for the member's role.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    @Inject(DB) private readonly db: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const req = context.switchToHttp().getRequest<TuelloRequest>();
    const res = context.switchToHttp().getResponse<Response>();
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets) ?? false;
    const permission = this.reflector.getAllAndOverride<Permission | undefined>(
      PERMISSION_KEY,
      targets,
    );
    const scope =
      this.reflector.getAllAndOverride<HostScope | undefined>(HOST_SCOPE_KEY, targets) ?? 'tenant';

    if (!isPublic && !permission) {
      this.logger.error(
        `Route ${context.getClass().name}.${context.getHandler().name} declares no permission`,
      );
      throw new Problem('internal_error', 'Route is missing a permission declaration.');
    }

    if (scope === 'apex' && req.hostKind !== 'apex') throw new Problem('not_found');
    if (scope === 'tenant' && !req.tenant) throw new Problem('tenant_not_found');

    if (isPublic && !permission) {
      // Public routes still learn who is signed in (e.g. invite acceptance), but never require it.
      if (req.tenant) await this.authenticate(req, res, false);
      return true;
    }

    await this.authenticate(req, res, true);
    if (!req.auth) throw new Problem('unauthenticated');
    if (req.tenant?.status === 'suspended') throw new Problem('tenant_suspended');
    if (!can(req.auth.role, permission!)) throw new Problem('forbidden');
    return true;
  }

  private async authenticate(req: TuelloRequest, res: Response, required: boolean): Promise<void> {
    const tenant = req.tenant;
    const token = (req.cookies as Record<string, string | undefined> | undefined)?.[SESSION_COOKIE];
    if (!tenant || !token) return;

    const found = await this.sessions.lookup(token, tenant.id);
    if (found.status !== 'ok') {
      this.sessions.clearCookie(res);
      if (found.status === 'mismatch' && required) throw new Problem('tenant_mismatch');
      return;
    }

    const { session, tokenHash } = found;
    const member = await this.db.withTenant({ tenantId: tenant.id, userId: session.userId }, (tx) =>
      tx.membership.findFirst({
        where: { userId: session.userId, deletedAt: null, status: 'active' },
        select: {
          id: true,
          role: true,
          user: { select: { email: true, name: true, passwordChangedAt: true, deletedAt: true } },
        },
      }),
    );
    if (
      !member ||
      member.user.deletedAt ||
      (member.user.passwordChangedAt && member.user.passwordChangedAt.getTime() > session.createdAt)
    ) {
      this.sessions.clearCookie(res);
      return;
    }

    req.auth = {
      sessionId: session.id,
      tokenHash,
      userId: session.userId,
      membershipId: member.id,
      role: member.role as Role,
      email: member.user.email,
      name: member.user.name,
    };
    await this.sessions.touch(tokenHash, session);
  }
}
