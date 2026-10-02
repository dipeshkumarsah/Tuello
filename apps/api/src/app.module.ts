import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { loadEnv } from './config/env';
import { AuthGuard } from './common/auth.guard';
import { CsrfGuard } from './common/csrf.guard';
import { ProblemFilter } from './common/problem.filter';
import { RateLimitGuard } from './common/rate-limit.guard';
import type { TuelloRequest } from './common/request';
import { RequestIdMiddleware } from './common/request-id.middleware';
import { TenantResolutionMiddleware } from './common/tenant-resolution.middleware';
import { TenantTransactionInterceptor } from './common/tenant-tx.interceptor';
import { InfraModule } from './infra/infra.module';
import { EventsModule } from './modules/events/events.module';
import { IdentityModule } from './modules/identity/identity.module';
import { MembersModule } from './modules/members/members.module';
import { OpsModule } from './modules/ops/ops.module';
import { TenantsModule } from './modules/tenants/tenants.module';

/** Never written to logs, wherever they appear. */
export const LOG_REDACT = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.token',
  '*.challengeToken',
  '*.code',
  '*.totpSecret',
  '*.passwordHash',
];

const env = loadEnv();

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: env.LOG_LEVEL,
        redact: { paths: LOG_REDACT, censor: '[redacted]' },
        // pino-http runs first and owns the id; RequestIdMiddleware echoes it in x-request-id.
        genReqId: (req: IncomingMessage) => {
          const incoming = req.headers['x-request-id'];
          return typeof incoming === 'string' && /^[A-Za-z0-9._-]{8,100}$/.test(incoming)
            ? incoming
            : randomUUID();
        },
        customProps: (req: IncomingMessage) => {
          const r = req as TuelloRequest;
          return { tenantId: r.tenant?.id, userId: r.auth?.userId };
        },
        serializers: {
          // Drop query strings: links can carry one-time tokens.
          req: (req: { id: string; method: string; url: string }) => ({
            id: req.id,
            method: req.method,
            path: req.url.split('?')[0],
          }),
        },
        autoLogging: {
          ignore: (req: IncomingMessage) => req.url === '/healthz' || req.url === '/readyz',
        },
        ...(env.NODE_ENV === 'development'
          ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
          : {}),
      },
    }),
    InfraModule,
    EventsModule,
    IdentityModule,
    TenantsModule,
    MembersModule,
    OpsModule,
  ],
  providers: [
    // Order matters: rate limit, then CSRF, then authentication + permission matrix.
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantTransactionInterceptor },
    { provide: APP_FILTER, useClass: ProblemFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware, TenantResolutionMiddleware).forRoutes('*');
  }
}
