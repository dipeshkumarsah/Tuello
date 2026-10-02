/** RFC 9457 problem details as returned by every API error. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code: string;
  requestId?: string;
  errors?: Array<{ path: string; code: string; message: string }>;
}

export const PROBLEM_BASE = 'https://docs.tuello.app/problems/';

export const PROBLEM_CODES = [
  'validation_failed',
  'unauthenticated',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'csrf_failed',
  'tenant_not_found',
  'tenant_mismatch',
  'tenant_suspended',
  'invalid_credentials',
  'email_not_verified',
  'mfa_required',
  'invalid_token',
  'slug_taken',
  'email_taken',
  'domain_taken',
  'internal_error',
] as const;
export type ProblemCode = (typeof PROBLEM_CODES)[number];
