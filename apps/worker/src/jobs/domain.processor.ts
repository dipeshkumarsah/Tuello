import type { Database } from '@tuello/db';
import {
  DOMAIN_VERIFICATION_PREFIX,
  type TlsProvisioner,
  type VerifyDomainJob,
} from '@tuello/shared';
import type { Job, Queue } from 'bullmq';
import type Redis from 'ioredis';
import type { WorkerEnv } from '../config';
import type { DnsResolver } from '../infra/dns';
import type { Log } from '../infra/logger';

export type DnsCheck = { ok: true } | { ok: false; error: string };

/**
 * Custom-domain verification. A tenant proves control with a TXT record
 * `_tuello-verify.{host}` = `tuello-verify={token}`. A missing record is not a job failure: the
 * domain stays pending and is re-checked with backoff until DOMAIN_MAX_CHECKS, then failed.
 */
export class DomainProcessor {
  constructor(
    private readonly db: Database,
    private readonly redis: Redis,
    private readonly dns: DnsResolver,
    private readonly tls: TlsProvisioner,
    private readonly env: WorkerEnv,
    private readonly log: Log,
  ) {}

  async check(hostname: string, token: string): Promise<DnsCheck> {
    const name = `${DOMAIN_VERIFICATION_PREFIX}.${hostname}`;
    try {
      const records = (await this.dns.resolveTxt(name)).map((chunks) => chunks.join(''));
      if (records.includes(`tuello-verify=${token}`)) return { ok: true };
      return {
        ok: false,
        error: records.length ? `TXT ${name} has a different value` : `No TXT record at ${name}`,
      };
    } catch (err) {
      const code = (err as { code?: string }).code ?? 'ERROR';
      return {
        ok: false,
        error:
          code === 'ENOTFOUND' || code === 'ENODATA'
            ? `No TXT record at ${name}`
            : `DNS lookup failed (${code})`,
      };
    }
  }

  verify = async (job: Job<VerifyDomainJob>) => {
    const { tenantId, domainId } = job.data;
    const outcome = await this.db.withTenant({ tenantId }, async (tx) => {
      const d = await tx.tenantDomain.findFirst({ where: { id: domainId, deletedAt: null } });
      if (!d || d.status === 'verified') return { status: 'skipped' as const };
      const result = await this.check(d.hostname, d.verificationToken);
      const now = new Date();
      if (result.ok) {
        await tx.tenantDomain.update({
          where: { id: d.id },
          data: {
            status: 'verified',
            verifiedAt: now,
            lastCheckedAt: now,
            lastError: null,
            checkAttempts: { increment: 1 },
          },
        });
        await tx.outboxEvent.create({
          data: {
            tenantId,
            name: 'domain.verified',
            aggregateType: 'domain',
            aggregateId: d.id,
            payload: { hostname: d.hostname },
          },
        });
        await tx.auditLog.create({
          data: {
            tenantId,
            action: 'domain.verified',
            entityType: 'domain',
            entityId: d.id,
            data: { hostname: d.hostname },
          },
        });
        return { status: 'verified' as const, hostname: d.hostname };
      }
      const attempts = d.checkAttempts + 1;
      const failed = attempts >= this.env.DOMAIN_MAX_CHECKS;
      await tx.tenantDomain.update({
        where: { id: d.id },
        data: {
          lastCheckedAt: now,
          lastError: result.error,
          checkAttempts: attempts,
          ...(failed ? { status: 'failed' } : {}),
        },
      });
      if (failed) {
        await tx.outboxEvent.create({
          data: {
            tenantId,
            name: 'domain.verification_failed',
            aggregateType: 'domain',
            aggregateId: d.id,
            payload: { hostname: d.hostname },
          },
        });
      }
      return { status: failed ? ('failed' as const) : ('pending' as const), hostname: d.hostname };
    });

    if (outcome.status === 'verified') {
      await this.redis.del(`tenant:domain:${outcome.hostname}`);
      await this.tls.allowHost(outcome.hostname);
      this.log.info({ tenantId, domainId }, 'domain verified');
    }
    return outcome;
  };

  /** Repeatable job: queue checks for pending domains that are due (backoff lives in SQL). */
  scan = async (_job: Job, queue: Queue) => {
    const due = await this.db.system.domainsDueForCheck(200);
    for (const d of due) {
      await queue.add(
        'verify-domain',
        { tenantId: d.tenantId, domainId: d.id },
        { jobId: `verify-${d.id}-${Math.floor(Date.now() / 60_000)}` },
      );
    }
    return { queued: due.length };
  };
}
