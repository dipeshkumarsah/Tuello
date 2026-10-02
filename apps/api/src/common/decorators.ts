import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiCookieAuth, ApiExtension } from '@nestjs/swagger';
import type { Permission } from '@tuello/shared';

export const PERMISSION_KEY = 'tuello:permission';
export const PUBLIC_KEY = 'tuello:public';
export const HOST_SCOPE_KEY = 'tuello:host-scope';
export const RATE_LIMIT_KEY = 'tuello:rate-limit';
export const NO_TENANT_TX_KEY = 'tuello:no-tenant-tx';

/** Which hosts a route answers on. Default: 'tenant'. */
export type HostScope = 'tenant' | 'apex' | 'any';

/** Route requires a signed-in member whose role has this permission in the matrix. */
export const RequirePermission = (permission: Permission) =>
  applyDecorators(
    SetMetadata(PERMISSION_KEY, permission),
    ApiCookieAuth('session'),
    ApiExtension('x-permission', permission),
  );

/** Route needs no session. Every route must carry either @Public() or @RequirePermission(). */
export const Public = () =>
  applyDecorators(SetMetadata(PUBLIC_KEY, true), ApiExtension('x-permission', 'public'));

export const HostScoped = (scope: HostScope) => SetMetadata(HOST_SCOPE_KEY, scope);

export interface RateLimitRule {
  /** What the counter is keyed by. `email` reads body.email. */
  by: 'ip' | 'tenant' | 'email';
  limit: number;
  windowSec: number;
}

export const RateLimit = (...rules: RateLimitRule[]) => SetMetadata(RATE_LIMIT_KEY, rules);

/** Skip the per-request tenant transaction (health checks, handlers that manage their own). */
export const NoTenantTransaction = () => SetMetadata(NO_TENANT_TX_KEY, true);
