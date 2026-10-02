import { ArgumentsHost, Catch, HttpException, Logger, type ExceptionFilter } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { Prisma } from '@tuello/db';
import {
  createTranslator,
  PROBLEM_BASE,
  type ProblemCode,
  type ProblemDetails,
} from '@tuello/shared';
import type { Response } from 'express';
import { logPath } from './log-path';
import { Problem } from './problem';
import type { TuelloRequest } from './request';

const t = createTranslator('en');

const STATUS_CODES: Record<number, ProblemCode> = {
  400: 'validation_failed',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'validation_failed',
  415: 'validation_failed',
  422: 'validation_failed',
  429: 'rate_limited',
};

/** Renders every error as RFC 9457 problem+json. Never leaks stack traces or SQL. */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger('Problem');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<TuelloRequest>();
    const res = ctx.getResponse<Response>();

    let status = 500;
    let code: ProblemCode = 'internal_error';
    let detail: string | undefined;
    let errors: ProblemDetails['errors'];
    let headers: Record<string, string> | undefined;

    if (exception instanceof Problem) {
      status = exception.getStatus();
      code = exception.code;
      detail = exception.detail;
      errors = exception.errors;
      headers = exception.headers;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = STATUS_CODES[status] ?? (status >= 500 ? 'internal_error' : 'validation_failed');
      if (status === 400) detail = 'Malformed request.';
    } else if (
      exception instanceof Prisma.PrismaClientKnownRequestError &&
      exception.code === 'P2002'
    ) {
      status = 409;
      code = 'conflict';
    } else if (
      exception instanceof Prisma.PrismaClientKnownRequestError &&
      exception.code === 'P2025'
    ) {
      status = 404;
      code = 'not_found';
    }

    if (status >= 500) {
      this.logger.error({ msg: 'unhandled error', err: exception, requestId: req.id });
      Sentry.captureException(exception, { tags: { requestId: req.id, tenantId: req.tenant?.id } });
    }

    const body: ProblemDetails = {
      type: `${PROBLEM_BASE}${code}`,
      title: t(`problem.${code}`),
      status,
      code,
      ...(detail ? { detail } : {}),
      ...(errors ? { errors } : {}),
      instance: req.originalUrl ? logPath(req.originalUrl) : undefined,
      requestId: req.id,
    };
    if (headers) for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    res.status(status).type('application/problem+json').send(JSON.stringify(body));
  }
}
