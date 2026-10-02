import type { CursorPage } from '@tuello/shared';
import { Problem } from './problem';

/**
 * Keyset pagination over (created_at, id), matching the (tenant_id, created_at) indexes.
 * The cursor is opaque to clients.
 */
export interface Cursor {
  createdAt: Date;
  id: string;
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(`${c.createdAt.toISOString()}|${c.id}`).toString('base64url');
}

export function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  const [iso, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
  const createdAt = new Date(iso ?? '');
  if (!id || Number.isNaN(createdAt.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) {
    throw new Problem('validation_failed', 'Invalid cursor.');
  }
  return { createdAt, id };
}

/** Prisma `where` fragment for rows after the cursor in descending (newest first) order. */
export function afterCursorDesc(cursor: Cursor | null) {
  if (!cursor) return {};
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };
}

export function afterCursorAsc(cursor: Cursor | null) {
  if (!cursor) return {};
  return {
    OR: [
      { createdAt: { gt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { gt: cursor.id } },
    ],
  };
}

/** Fetch limit + 1 rows, then call this. */
export function toPage<R extends { createdAt: Date; id: string }, T>(
  rows: R[],
  limit: number,
  map: (r: R) => T,
): CursorPage<T> {
  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const last = slice[slice.length - 1];
  return { items: slice.map(map), nextCursor: hasMore && last ? encodeCursor(last) : null };
}
