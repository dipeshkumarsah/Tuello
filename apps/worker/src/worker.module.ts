import { Module } from '@nestjs/common';
import { createDatabase } from '@tuello/db';
import { DB, ENV, loadEnv, type WorkerEnv } from './config';
import { DnsResolver, SystemDnsResolver } from './infra/dns';
import { createLogger, LOG, type Log } from './infra/logger';
import { Mailer, SmtpMailer } from './infra/mailer';
import { WorkerService } from './worker.service';

@Module({
  providers: [
    { provide: ENV, useFactory: () => loadEnv() },
    {
      provide: LOG,
      inject: [ENV],
      useFactory: (env: WorkerEnv) => createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development'),
    },
    {
      provide: DB,
      inject: [ENV, LOG],
      useFactory: (env: WorkerEnv, log: Log) =>
        createDatabase({
          url: env.DATABASE_URL,
          slowQueryMs: 500,
          onSlowQuery: (e) =>
            log.warn({ durationMs: e.durationMs, query: e.query.slice(0, 500) }, 'slow query'),
          onAfterCommitError: (err) => log.error({ err }, 'afterCommit failed'),
        }),
    },
    {
      provide: Mailer,
      inject: [ENV],
      useFactory: (env: WorkerEnv) => new SmtpMailer(env.SMTP_URL),
    },
    {
      provide: DnsResolver,
      inject: [ENV],
      useFactory: (env: WorkerEnv) =>
        new SystemDnsResolver(
          env.DNS_SERVERS?.split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        ),
    },
    WorkerService,
  ],
})
export class WorkerModule {}
