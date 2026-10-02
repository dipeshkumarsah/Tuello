import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { REQUEST_ID_HEADER } from '@tuello/shared';
import type { TuelloRequest } from './request';

const SAFE_ID = /^[A-Za-z0-9._-]{8,100}$/;

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: TuelloRequest, res: Response, next: NextFunction) {
    // pino-http may already have assigned one (and logs it); keep a single id per request.
    const incoming = req.headers[REQUEST_ID_HEADER];
    const existing = typeof req.id === 'string' && req.id ? req.id : null;
    const id =
      existing ??
      (typeof incoming === 'string' && SAFE_ID.test(incoming) ? incoming : randomUUID());
    req.id = id;
    res.setHeader(REQUEST_ID_HEADER, id);
    next();
  }
}
