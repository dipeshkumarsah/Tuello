import { Prisma } from '@prisma/client';
import {
  MissingTenantContextError,
  TenantContextMismatchError,
  tenantStorage,
  type TenantContext,
  type TenantStore,
  type TxClient,
} from './context';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface WithTenantOptions {
  timeoutMs?: number;
  maxWaitMs?: number;
}

export interface AfterCommitErrorHandler {
  (error: unknown): void;
}

/**
 * THE tenant-scoping Prisma client extension.
 *
 * - `$withTenant(ctx, fn)` opens one interactive transaction, runs
 *   `SET LOCAL app.tenant_id / app.user_id` (via set_config(..., true)) as its first statement,
 *   and runs `fn` with that transaction available through AsyncLocalStorage.
 * - Every model operation outside such a scope throws MissingTenantContextError before it
 *   reaches the database. (The database raises too: RLS policies call app.current_tenant_id(),
 *   which raises when the setting is missing.)
 */
export function tenantScopeExtension(onAfterCommitError: AfterCommitErrorHandler = () => {}) {
  return Prisma.defineExtension((client) =>
    client.$extends({
      name: 'tuello-tenant-scope',
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            if (!tenantStorage.getStore()) {
              throw new MissingTenantContextError(`${model}.${operation}`);
            }
            return query(args);
          },
        },
      },
      client: {
        async $withTenant<T>(
          ctx: TenantContext,
          fn: (tx: TxClient) => Promise<T>,
          options: WithTenantOptions = {},
        ): Promise<T> {
          if (!UUID_RE.test(ctx.tenantId)) throw new Error('withTenant: tenantId must be a UUID');
          if (ctx.userId && !UUID_RE.test(ctx.userId))
            throw new Error('withTenant: userId must be a UUID');

          const open = tenantStorage.getStore();
          if (open) {
            if (open.ctx.tenantId !== ctx.tenantId) {
              throw new TenantContextMismatchError(open.ctx.tenantId, ctx.tenantId);
            }
            return await fn(open.tx);
          }

          const self = Prisma.getExtensionContext(this) as unknown as {
            $transaction: <R>(
              fn: (tx: TxClient) => Promise<R>,
              opts: { timeout: number; maxWait: number },
            ) => Promise<R>;
          };
          const afterCommit: TenantStore['afterCommit'] = [];
          const result = await self.$transaction(
            async (tx) => {
              await tx.$executeRaw`SELECT set_config('app.tenant_id', ${ctx.tenantId}, true), set_config('app.user_id', ${ctx.userId ?? ''}, true)`;
              // `await` inside run(): Prisma promises are lazy and must be *executed* inside the scope.
              return tenantStorage.run(
                { ctx: { ...ctx }, tx, afterCommit },
                async () => await fn(tx),
              );
            },
            { timeout: options.timeoutMs ?? 15_000, maxWait: options.maxWaitMs ?? 5_000 },
          );
          for (const cb of afterCommit) {
            try {
              await cb();
            } catch (error) {
              onAfterCommitError(error);
            }
          }
          return result;
        },
      },
    }),
  );
}
