import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma } from '@prisma/client';

export interface TenantContext {
  tenantId: string;
  userId?: string | null;
}

export type TxClient = Prisma.TransactionClient;

export interface TenantStore {
  ctx: TenantContext;
  tx: TxClient;
  afterCommit: Array<() => unknown | Promise<unknown>>;
}

/** One AsyncLocalStorage per process: holds the open tenant transaction for the current request/job. */
export const tenantStorage = new AsyncLocalStorage<TenantStore>();

export class MissingTenantContextError extends Error {
  readonly code = 'TENANT_CONTEXT_MISSING';
  constructor(what: string) {
    super(
      `Tenant context missing for ${what}. Wrap the call in db.withTenant({ tenantId, userId }, ...).`,
    );
    this.name = 'MissingTenantContextError';
  }
}

export class TenantContextMismatchError extends Error {
  constructor(open: string, requested: string) {
    super(
      `A transaction for tenant ${open} is already open; refusing to nest tenant ${requested}.`,
    );
    this.name = 'TenantContextMismatchError';
  }
}

export function currentTenantStore(): TenantStore | undefined {
  return tenantStorage.getStore();
}
