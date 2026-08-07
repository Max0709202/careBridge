import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError } from './errors';

/**
 * One error envelope for the whole API:
 * `{ error: { code, message, correlationId, field? } }`.
 *
 * Two rules hold here and nowhere else needs to remember them:
 *
 * 1. Users get a generic message plus a correlation id; the detail stays
 *    server-side. An unexpected exception never reaches the client as a stack
 *    trace or a database message — a Prisma constraint error, printed verbatim,
 *    leaks table and column names.
 * 2. `AuthorizationError` and `NotFoundError` are already indistinguishable by
 *    construction (same message, same 404). Nothing here re-separates them.
 */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const correlationId = request.correlationId ?? 'unknown';

    if (exception instanceof AppError) {
      // Expected, modelled failure. Logged at debug: it is the system working.
      this.logger.debug(
        `${request.method} ${request.path} -> ${exception.status} ${exception.code} [${correlationId}]`,
      );
      response.status(exception.status).json({
        error: {
          code: exception.code,
          message: exception.message,
          correlationId,
          ...(exception.field ? { field: exception.field } : {}),
        },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      // class-validator surfaces its messages through the ValidationPipe as a
      // BadRequestException whose body carries a `message` array. Flatten the
      // first one — a field-level hint the user can act on.
      const message =
        typeof body === 'object' && body !== null && 'message' in body
          ? normaliseMessage((body as { message: unknown }).message)
          : exception.message;

      this.logger.debug(
        `${request.method} ${request.path} -> ${status} [${correlationId}]`,
      );
      response.status(status).json({
        error: {
          code: status === 400 ? 'validation' : 'internal',
          message,
          correlationId,
        },
      });
      return;
    }

    // Genuinely unexpected. Log it in full, tell the user nothing.
    this.logger.error(
      `${request.method} ${request.path} -> 500 [${correlationId}]`,
      exception instanceof Error ? exception.stack : String(exception),
    );
    response.status(500).json({
      error: {
        code: 'internal',
        message: 'Something went wrong on our side. Please try again.',
        correlationId,
      },
    });
  }
}

function normaliseMessage(message: unknown): string {
  if (Array.isArray(message) && message.length > 0) return String(message[0]);
  if (typeof message === 'string') return message;
  return 'That request could not be processed.';
}
