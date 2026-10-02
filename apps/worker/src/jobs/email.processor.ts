import type { Database } from '@tuello/db';
import { checkAccentContrast, type SendEmailJob } from '@tuello/shared';
import type { Job } from 'bullmq';
import type Redis from 'ioredis';
import type { WorkerEnv } from '../config';
import { renderEmail, type Brand } from '../email/templates';
import type { Log } from '../infra/logger';
import type { Mailer } from '../infra/mailer';
import type { Storage } from '../infra/storage';

/**
 * Sends one transactional email with the tenant's branding. Idempotent: a job that already
 * delivered (e.g. crashed after SMTP accepted) is not sent twice.
 */
export class EmailProcessor {
  constructor(
    private readonly db: Database,
    private readonly redis: Redis,
    private readonly mailer: Mailer,
    private readonly storage: Storage,
    private readonly env: WorkerEnv,
    private readonly log: Log,
  ) {}

  async loadBrand(tenantId: string): Promise<Brand> {
    const { tenant, branding } = await this.db.withTenant({ tenantId }, async (tx) => ({
      tenant: await tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { name: true },
      }),
      branding: await tx.tenantBranding.findUnique({ where: { tenantId } }),
    }));
    return {
      companyName: tenant.name,
      senderName: branding?.emailSenderName ?? tenant.name,
      replyTo: branding?.emailReplyTo ?? null,
      logoUrl: branding?.logoKey
        ? await this.storage.signedGetUrl(branding.logoKey).catch(() => null)
        : null,
      accentColor: branding?.accentColor ?? null,
      accentTextColor: branding?.accentColor
        ? checkAccentContrast(branding.accentColor).textColor
        : null,
    };
  }

  process = async (job: Job<SendEmailJob>) => {
    const sentKey = `email:sent:${job.id}`;
    if (await this.redis.exists(sentKey)) return { skipped: 'already-sent' };
    const { tenantId, template, to, vars, locale } = job.data;
    const brand = await this.loadBrand(tenantId);
    const rendered = renderEmail(template, vars, brand, locale);
    const sender = brand.senderName.replace(/["\r\n<>]/g, '');
    const result = await this.mailer.send({
      from: `"${sender}" <${this.env.EMAIL_FROM_ADDRESS}>`,
      ...(brand.replyTo ? { replyTo: brand.replyTo } : {}),
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      headers: { 'X-Entity-Ref-ID': String(job.id) },
    });
    await this.redis.set(sentKey, '1', 'EX', 7 * 24 * 3600);
    this.log.info({ jobId: job.id, tenantId, template, messageId: result.messageId }, 'email sent');
    return { messageId: result.messageId };
  };
}
