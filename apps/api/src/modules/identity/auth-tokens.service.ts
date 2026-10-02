import { Inject, Injectable } from '@nestjs/common';
import type { AuthTokenPurpose, Database } from '@tuello/db';
import { TOKEN_TTL_SECONDS } from '@tuello/shared';
import { hashToken, newToken } from '../../infra/crypto';
import { DB } from '../../infra/tokens';

/** Single-use, hashed, tenant-scoped tokens for email links. All methods need a tenant transaction. */
@Injectable()
export class AuthTokensService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async issue(userId: string, purpose: AuthTokenPurpose): Promise<string> {
    const ctx = this.db.context()!;
    // A new link supersedes older ones of the same kind.
    await this.db.tx.authToken.updateMany({
      where: { userId, purpose, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    const token = newToken();
    await this.db.tx.authToken.create({
      data: {
        tenantId: ctx.tenantId,
        userId,
        purpose,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + TOKEN_TTL_SECONDS[purpose] * 1000),
      },
    });
    return token;
  }

  /** Returns the user ID once; a second call, an expired token, or another tenant's token yields null. */
  async consume(token: string, purpose: AuthTokenPurpose): Promise<string | null> {
    const row = await this.db.tx.authToken.findFirst({
      where: { tokenHash: hashToken(token), purpose },
      select: { id: true, userId: true, expiresAt: true, consumedAt: true },
    });
    if (!row || row.consumedAt || row.expiresAt.getTime() <= Date.now()) return null;
    const claimed = await this.db.tx.authToken.updateMany({
      where: { id: row.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    return claimed.count === 1 ? row.userId : null;
  }
}
