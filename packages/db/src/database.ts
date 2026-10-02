import { Prisma, PrismaClient } from '@prisma/client';
import {
  MissingTenantContextError,
  tenantStorage,
  type TenantContext,
  type TxClient,
} from './context';
import { createSystemQueries, type SystemQueries } from './system';
import { tenantScopeExtension, type WithTenantOptions } from './tenant-extension';

export interface DatabaseOptions {
  url: string;
  log?: Prisma.LogLevel[];
  /** Called when an afterCommit callback throws (the transaction itself already committed). */
  onAfterCommitError?: (error: unknown) => void;
  /** Queries slower than this are reported through onSlowQuery. */
  slowQueryMs?: number;
  onSlowQuery?: (event: { query: string; durationMs: number }) => void;
}

function buildClient(opts: DatabaseOptions) {
  const base = new PrismaClient({
    datasourceUrl: opts.url,
    log: [
      ...(opts.log ?? []).map((level) => ({ level, emit: 'stdout' as const })),
      ...(opts.onSlowQuery ? [{ level: 'query' as const, emit: 'event' as const }] : []),
    ],
  });
  if (opts.onSlowQuery) {
    const threshold = opts.slowQueryMs ?? 200;
    (base as unknown as PrismaClient<Prisma.PrismaClientOptions, 'query'>).$on('query', (e) => {
      if (e.duration >= threshold) opts.onSlowQuery!({ query: e.query, durationMs: e.duration });
    });
  }
  return { base, scoped: base.$extends(tenantScopeExtension(opts.onAfterCommitError)) };
}

export type ScopedClient = ReturnType<typeof buildClient>['scoped'];

export interface Database {
  /** Run `fn` inside one tenant-scoped transaction (SET LOCAL app.tenant_id / app.user_id). */
  withTenant<T>(
    ctx: TenantContext,
    fn: (tx: TxClient) => Promise<T>,
    options?: WithTenantOptions,
  ): Promise<T>;
  /**
   * The open tenant transaction for the current async scope. Accessing any model on it outside
   * withTenant throws MissingTenantContextError.
   */
  readonly tx: TxClient;
  /** Current tenant context, if any. */
  context(): TenantContext | undefined;
  /** Change app.user_id inside the open transaction (signup, invite acceptance, password reset). */
  setUser(userId: string): Promise<void>;
  /** Defer work (e.g. enqueueing a job) until the open transaction commits. */
  afterCommit(fn: () => unknown | Promise<unknown>): void;
  /** Pre-tenant lookups through SECURITY DEFINER functions. */
  readonly system: SystemQueries;
  /** The guarded client. Model calls outside withTenant throw. */
  readonly client: ScopedClient;
  disconnect(): Promise<void>;
}

export function createDatabase(opts: DatabaseOptions): Database {
  const { base, scoped } = buildClient(opts);

  const txProxy = new Proxy({} as TxClient, {
    get(_target, prop) {
      const store = tenantStorage.getStore();
      if (!store) throw new MissingTenantContextError(`tx.${String(prop)}`);
      const value = (store.tx as unknown as Record<string | symbol, unknown>)[prop];
      return typeof value === 'function'
        ? (value as (...a: unknown[]) => unknown).bind(store.tx)
        : value;
    },
  });

  return {
    withTenant: (ctx, fn, options) => scoped.$withTenant(ctx, fn, options),
    get tx() {
      return txProxy;
    },
    context: () => tenantStorage.getStore()?.ctx,
    async setUser(userId: string) {
      const store = tenantStorage.getStore();
      if (!store) throw new MissingTenantContextError('setUser');
      await store.tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`;
      store.ctx.userId = userId;
    },
    afterCommit(fn) {
      const store = tenantStorage.getStore();
      if (!store) throw new MissingTenantContextError('afterCommit');
      store.afterCommit.push(fn);
    },
    system: createSystemQueries(base),
    client: scoped,
    disconnect: () => base.$disconnect(),
  };
}
