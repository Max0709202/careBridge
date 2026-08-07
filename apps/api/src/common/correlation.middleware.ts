import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

declare module 'express-serve-static-core' {
  interface Request {
    correlationId?: string;
  }
}

/**
 * One id per request, echoed to the client and attached to every log line and
 * audit row for it. When a user reports "it said something went wrong", the
 * correlation id on their screen is the only thing that connects their sentence
 * to a specific stack trace — without it, support is guesswork.
 */
@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header('x-correlation-id');
    const id = incoming && incoming.length <= 64 ? incoming : randomUUID();
    req.correlationId = id;
    res.setHeader('x-correlation-id', id);
    next();
  }
}
