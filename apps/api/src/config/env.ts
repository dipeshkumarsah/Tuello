import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

/** Every setting comes from the environment. See .env.example at the repo root. */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().url(),
  SLOW_QUERY_MS: z.coerce.number().int().default(200),
  VALKEY_URL: z.string().default('redis://localhost:6379'),

  /** e.g. tuello.app in production, tuello.localhost in development. */
  APP_BASE_DOMAIN: z.string().default('tuello.localhost'),
  /** Scheme and port used to build links to tenant hosts. */
  APP_PUBLIC_PROTOCOL: z.enum(['http', 'https']).default('http'),
  APP_PUBLIC_PORT: z.string().optional(),
  /** CNAME target tenants point custom domains at. */
  CUSTOM_DOMAIN_TARGET: z.string().default('domains.tuello.localhost'),
  TRUST_PROXY: bool.default(true),

  COOKIE_SECURE: bool.default(true),
  /** 32-byte key, base64. Encrypts TOTP secrets at rest. */
  ENCRYPTION_KEY: z
    .string()
    .refine(
      (v) => Buffer.from(v, 'base64').length === 32,
      'ENCRYPTION_KEY must be 32 bytes, base64',
    ),

  RATE_LIMIT_FACTOR: z.coerce.number().positive().default(1),

  S3_ENDPOINT: z.string().optional(),
  S3_PUBLIC_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().default('tuello'),
  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),
  S3_FORCE_PATH_STYLE: bool.default(false),

  TURNSTILE_SECRET_KEY: z.string().optional(),

  /** caddy-on-demand (Caddy asks /v1/internal/tls/ask) or noop. */
  TLS_PROVISIONER: z.enum(['caddy-on-demand', 'noop']).default('caddy-on-demand'),

  SENTRY_DSN: z.string().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().default('tuello-api'),
  RELEASE: z.string().default('dev'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return parsed.data;
}

export const ENV = Symbol('ENV');
