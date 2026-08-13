import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

import { runWithCorrelation } from './logging/correlation-store';

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
 *
 * The id is also put into async-local storage, so code far below the
 * controller can be correlated without every function in between growing a
 * context parameter.
 */
@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header('x-correlation-id');
    // Bounded and pattern-checked: this value is echoed in a response header
    // and written to logs, so an unbounded client-supplied string is a header
    // injection and a log-forging primitive at the same time.
    const id =
      incoming && /^[A-Za-z0-9._-]{1,64}$/.test(incoming) ? incoming : randomUUID();

    req.correlationId = id;
    res.setHeader('x-correlation-id', id);

    runWithCorrelation(id, () => {
      next();
    });
  }
}
