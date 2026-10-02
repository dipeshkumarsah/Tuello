import type { QueueName } from './constants';

export type EmailTemplate = 'verify_email' | 'invite' | 'reset_password' | 'magic_link';

/** Job payload for the `email` queue. Links carry one-time tokens: never log this payload. */
export interface SendEmailJob {
  tenantId: string;
  template: EmailTemplate;
  to: string;
  locale: string;
  vars: Record<string, string>;
}

export interface VerifyDomainJob {
  tenantId: string;
  domainId: string;
}

export interface DeadLetterJob {
  tenantId: string | null;
  originalQueue: QueueName;
  originalJobId: string;
  name: string;
  data: unknown;
  failedReason: string;
  attemptsMade: number;
  failedAt: string;
}

/** Shared retry policy: 8 attempts, exponential from 5 s (5 s .. ~10 min). */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 8,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

export interface ImportJobData {
  tenantId: string;
  importId: string;
  userId: string | null;
}

export type ExportEntity = 'clients' | 'brokerages' | 'services' | 'add_ons' | 'packages' | 'coupons';

export interface ExportJobData {
  tenantId: string;
  exportId: string;
  entity: ExportEntity;
  filters: Record<string, unknown>;
}
