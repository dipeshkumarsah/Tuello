export const SESSION_COOKIE = 'tuello_session';
export const CSRF_COOKIE = 'tuello_csrf';
export const CSRF_HEADER = 'x-csrf-token';
export const REQUEST_ID_HEADER = 'x-request-id';

/** Absolute session lifetime and idle timeout. */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;
export const SESSION_IDLE_SECONDS = 60 * 60 * 24 * 3;

export const TOKEN_TTL_SECONDS = {
  verify_email: 60 * 60 * 24,
  reset_password: 60 * 60,
  magic_link: 60 * 15,
  invite: 60 * 60 * 24 * 7,
  handoff: 60,
  mfa_challenge: 60 * 5,
} as const;

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;

/** Slugs that can never be a tenant subdomain. */
export const RESERVED_SLUGS = new Set([
  'app',
  'www',
  'api',
  'admin',
  'mail',
  'email',
  'smtp',
  'status',
  'docs',
  'help',
  'support',
  'billing',
  'static',
  'assets',
  'cdn',
  'media',
  'files',
  'auth',
  'login',
  'signup',
  'dashboard',
  'tuello',
  'internal',
  'system',
  'root',
  'test',
]);

/** TXT record a tenant publishes to prove control of a custom domain. */
export const DOMAIN_VERIFICATION_PREFIX = '_tuello-verify';

export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/svg+xml',
  'image/webp',
] as const;

export const QUEUES = {
  email: 'email',
  outbox: 'outbox',
  events: 'events',
  domains: 'domains',
  deadLetter: 'dead-letter',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
