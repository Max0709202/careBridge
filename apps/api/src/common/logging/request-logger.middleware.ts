import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { LOGGER } from './logger.token';
import type { Logger as PinoLogger } from 'pino';
import { currentCorrelationId, currentUserId } from './correlation-store';

/**
 * One line per completed request.
 *
 * Written by hand rather than with `pino-http` because what we want logged is
 * a short, fixed set of fields — and `pino-http`'s default serialisers log the
 * whole request object, which means the denylist becomes the only thing
 * standing between a query string and a log sink. Choosing the fields
 * explicitly is a smaller surface to get wrong.
 *
 * The path is the **route pattern** where Express can give us one
 * (`/api/v1/patients/:id`), not the concrete URL. A concrete URL puts record
 * ids into log storage and makes every request its own cardinality bucket in
 * any metric derived from these lines.
 */
@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  constructor(@Inject(LOGGER) private readonly logger: PinoLogger) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const startedAt = process.hrtime.bigint();

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

      // 5xx is ours; 4xx is usually the caller's and should not page anyone.
      const level =
        res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

      this.logger[level](
        {
          context: 'Http',
          correlationId: currentCorrelationId(),
          userId: currentUserId(),
          method: req.method,
          route: routePattern(req),
          status: res.statusCode,
          durationMs: Math.round(durationMs * 100) / 100,
        },
        'request',
      );
    });

    next();
  }
}

function routePattern(req: Request): string {
  const route = (req.route as { path?: string } | undefined)?.path;
  if (route) return `${req.baseUrl}${route}`;
  // No matched route (a 404, or a middleware short-circuit). The raw path is
  // the only thing available, and a path nobody routed carries no record id
  // we put there.
  return req.path;
}
