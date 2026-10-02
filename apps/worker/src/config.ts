import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().url(),
  VALKEY_URL: z.string().default('redis://localhost:6379'),

  SMTP_URL: z.string().default('smtp://localhost:1025'),
  EMAIL_FROM_ADDRESS: z.string().email().default('no-reply@tuello.localhost'),

  CUSTOM_DOMAIN_TARGET: z.string().default('domains.tuello.localhost'),
  /** Optional comma-separated DNS servers for verification lookups (default: system resolver). */
  DNS_SERVERS: z.string().optional(),
  DOMAIN_MAX_CHECKS: z.coerce.number().int().default(60),
  DOMAIN_SCAN_EVERY_MS: z.coerce
    .number()
    .int()
    .default(5 * 60 * 1000),
  TLS_PROVISIONER: z.enum(['caddy-on-demand', 'noop']).default('caddy-on-demand'),

  OUTBOX_POLL_MS: z.coerce.number().int().default(1000),
  OUTBOX_BATCH: z.coerce.number().int().default(200),
  WORKER_CONCURRENCY: z.coerce.number().int().default(10),
  HEALTH_PORT: z.coerce.number().int().default(4100),

  S3_ENDPOINT: z.string().optional(),
  S3_PUBLIC_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().default('tuello'),
  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),
  S3_FORCE_PATH_STYLE: bool.default(false),

  SENTRY_DSN: z.string().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().default('tuello-worker'),
});

export type WorkerEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment:\n${parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`,
    );
  }
  return parsed.data;
}

export const ENV = Symbol('ENV');
export const DB = Symbol('DB');
export const REDIS = Symbol('REDIS');
