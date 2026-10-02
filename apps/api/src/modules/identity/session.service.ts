import { Inject, Injectable } from '@nestjs/common';
import type { Database } from '@tuello/db';
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  SESSION_IDLE_SECONDS,
  SESSION_TTL_SECONDS,
} from '@tuello/shared';
import type { Request, Response } from 'express';
import type Redis from 'ioredis';
import { ENV, type Env } from '../../config/env';
import { clientIp } from '../../common/request';
import { hashToken, newToken } from '../../infra/crypto';
import { DB, REDIS } from '../../infra/tokens';

export interface CachedSession {
  id: string;
  tenantId: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
}

const TOUCH_EVERY_MS = 5 * 60 * 1000;

/**
 * Sessions: an opaque random token in an httpOnly cookie. Valkey holds the hot copy keyed by the
 * token hash; PostgreSQL holds the durable, tenant-scoped record (listing, revocation, and
 * fallback if Valkey loses data). API servers stay stateless.
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private key(hash: string) {
    return `sess:${hash}`;
  }

  /** Must run inside the tenant transaction. Valkey is written after commit. */
  async create(
    req: Request,
    tenantId: string,
    userId: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = newToken();
    const tokenHash = hashToken(token);
    const now = Date.now();
    const expiresAt = new Date(now + SESSION_TTL_SECONDS * 1000);
    const row = await this.db.tx.session.create({
      data: {
        tenantId,
        userId,
        tokenHash,
        ip: clientIp(req),
        userAgent: (req.headers['user-agent'] ?? '').slice(0, 300) || null,
        expiresAt,
        // App clock, not the transaction's now(): compared with users.password_changed_at.
        createdAt: new Date(now),
        lastSeenAt: new Date(now),
      },
    });
    const cached: CachedSession = {
      id: row.id,
      tenantId,
      userId,
      createdAt: row.createdAt.getTime(),
      expiresAt: expiresAt.getTime(),
      lastSeenAt: now,
    };
    this.db.afterCommit(() => this.cache(tokenHash, cached));
    return { token, expiresAt };
  }

  private async cache(tokenHash: string, s: CachedSession) {
    const ttl = Math.max(1, Math.floor((s.expiresAt - Date.now()) / 1000));
    await this.redis.set(this.key(tokenHash), JSON.stringify(s), 'EX', ttl);
  }

  /**
   * Finds a live session for this token. `hostTenantId` is the tenant the request host resolved
   * to; a session that belongs to another tenant is reported as a mismatch.
   */
  async lookup(
    token: string,
    hostTenantId: string,
  ): Promise<
    { status: 'ok'; session: CachedSession; tokenHash: string } | { status: 'none' | 'mismatch' }
  > {
    const tokenHash = hashToken(token);
    const raw = await this.redis.get(this.key(tokenHash));
    let session: CachedSession | null = raw ? (JSON.parse(raw) as CachedSession) : null;

    if (!session) {
      // Valkey miss: the durable record, looked up inside the HOST tenant only.
      const row = await this.db.withTenant({ tenantId: hostTenantId }, (tx) =>
        tx.session.findUnique({
          where: { tenantId_tokenHash: { tenantId: hostTenantId, tokenHash } },
        }),
      );
      if (!row || row.revokedAt) return { status: 'none' };
      session = {
        id: row.id,
        tenantId: row.tenantId,
        userId: row.userId,
        createdAt: row.createdAt.getTime(),
        expiresAt: row.expiresAt.getTime(),
        lastSeenAt: row.lastSeenAt.getTime(),
      };
      if (session.expiresAt > Date.now()) await this.cache(tokenHash, session);
    }

    const now = Date.now();
    if (session.expiresAt <= now || now - session.lastSeenAt > SESSION_IDLE_SECONDS * 1000) {
      await this.redis.del(this.key(tokenHash));
      return { status: 'none' };
    }
    if (session.tenantId !== hostTenantId) return { status: 'mismatch' };
    return { status: 'ok', session, tokenHash };
  }

  /** Sliding idle timeout, written at most every 5 minutes. */
  async touch(tokenHash: string, session: CachedSession): Promise<void> {
    if (Date.now() - session.lastSeenAt < TOUCH_EVERY_MS) return;
    const next = { ...session, lastSeenAt: Date.now() };
    await this.cache(tokenHash, next);
    await this.db.withTenant({ tenantId: session.tenantId }, (tx) =>
      tx.session.updateMany({
        where: { id: session.id },
        data: { lastSeenAt: new Date(next.lastSeenAt) },
      }),
    );
  }

  /** Inside a tenant transaction. */
  async revoke(where: { id?: string; userId?: string; exceptId?: string }): Promise<number> {
    const rows = await this.db.tx.session.findMany({
      where: {
        revokedAt: null,
        ...(where.id ? { id: where.id } : {}),
        ...(where.userId ? { userId: where.userId } : {}),
        ...(where.exceptId ? { NOT: { id: where.exceptId } } : {}),
      },
      select: { id: true, tokenHash: true },
    });
    if (rows.length === 0) return 0;
    await this.db.tx.session.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { revokedAt: new Date() },
    });
    const keys = rows.map((r) => this.key(r.tokenHash));
    this.db.afterCommit(() => this.redis.del(...keys));
    await this.redis.del(...keys);
    return rows.length;
  }

  cookieOptions(expires?: Date) {
    return {
      httpOnly: true,
      secure: this.env.COOKIE_SECURE,
      sameSite: 'lax' as const,
      path: '/',
      ...(expires ? { expires } : {}),
    };
  }

  setCookie(res: Response, token: string, expiresAt: Date) {
    res.cookie(SESSION_COOKIE, token, this.cookieOptions(expiresAt));
  }

  clearCookie(res: Response) {
    res.clearCookie(SESSION_COOKIE, this.cookieOptions());
  }

  csrfCookieOptions() {
    return { httpOnly: false, secure: this.env.COOKIE_SECURE, sameSite: 'lax' as const, path: '/' };
  }

  issueCsrf(res: Response): string {
    const token = newToken();
    res.cookie(CSRF_COOKIE, token, this.csrfCookieOptions());
    return token;
  }
}
