import { HttpException } from '@nestjs/common';
import type { ProblemCode } from '@tuello/shared';

const STATUS: Record<ProblemCode, number> = {
  validation_failed: 422,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  csrf_failed: 403,
  tenant_not_found: 404,
  tenant_mismatch: 401,
  tenant_suspended: 403,
  invalid_credentials: 401,
  email_not_verified: 403,
  mfa_required: 401,
  invalid_token: 400,
  slug_taken: 409,
  email_taken: 409,
  domain_taken: 409,
  internal_error: 500,
};

/** Throw this from anywhere; the problem filter renders it as RFC 9457 JSON. */
export class Problem extends HttpException {
  constructor(
    readonly code: ProblemCode,
    readonly detail?: string,
    readonly errors?: Array<{ path: string; code: string; message: string }>,
    readonly headers?: Record<string, string>,
  ) {
    super(code, STATUS[code]);
  }
}
