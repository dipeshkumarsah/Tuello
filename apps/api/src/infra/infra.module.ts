import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createDatabase, type Database } from '@tuello/db';
import Redis from 'ioredis';
import { ENV, loadEnv, type Env } from '../config/env';
import { BotCheckService } from './bot-check.service';
import { QueueService } from './queue.service';
import { StorageService } from './storage.service';
import { TlsProvisioner, createTlsProvisioner } from './tls-provisioner';
import { DB, REDIS } from './tokens';

@Global()
@Module({
  providers: [
    { provide: ENV, useFactory: () => loadEnv() },
    {
      provide: DB,
      inject: [ENV],
      useFactory: (env: Env): Database => {
        const logger = new Logger('Database');
        return createDatabase({
          url: env.DATABASE_URL,
          slowQueryMs: env.SLOW_QUERY_MS,
          onSlowQuery: ({ query, durationMs }) =>
            logger.warn({ msg: 'slow query', durationMs, query: query.slice(0, 500) }),
          onAfterCommitError: (error) =>
            logger.error({ msg: 'afterCommit callback failed', err: error }),
        });
      },
    },
    {
      provide: REDIS,
      inject: [ENV],
      useFactory: (env: Env) =>
        new Redis(env.VALKEY_URL, { maxRetriesPerRequest: null, lazyConnect: false }),
    },
    QueueService,
    StorageService,
    BotCheckService,
    { provide: TlsProvisioner, inject: [ENV], useFactory: (env: Env) => createTlsProvisioner(env) },
  ],
  exports: [ENV, DB, REDIS, QueueService, StorageService, BotCheckService, TlsProvisioner],
})
export class InfraModule implements OnApplicationShutdown {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async onApplicationShutdown() {
    await this.db.disconnect();
    this.redis.disconnect();
  }
}
