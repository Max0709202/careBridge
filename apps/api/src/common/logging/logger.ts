import { type LoggerService, type LogLevel } from '@nestjs/common';
import pino, { type Logger as PinoLogger } from 'pino';

import { REDACTION_CENSOR, REDACTION_PATHS } from './redaction';
import { currentCorrelationId } from './correlation-store';

/**
 * One pino instance for the process, wrapped in the interface Nest expects.
 *
 * Nest's default logger writes human prose to stdout with no structure and no
 * redaction. Replacing it wholesale — rather than adding a second logger
 * alongside it — is deliberate: a second logger means framework lines
 * (`Nest application successfully started`, and, more to the point, unhandled
 * exception dumps) bypass the denylist entirely.
 */
export function createRootLogger(options: {
  level: string;
  pretty: boolean;
  serviceVersion: string;
  environment: string;
}): PinoLogger {
  return pino({
    level: options.level,
    base: {
      service: 'carebridge-api',
      env: options.environment,
      version: options.serviceVersion,
    },
    redact: { paths: REDACTION_PATHS, censor: REDACTION_CENSOR },
    // `time` as ISO-8601 rather than epoch millis: the person reading this is
    // usually correlating it against a user's "it broke around 10:40".
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    ...(options.pretty && prettyIsAvailable()
      ? {
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'HH:MM:ss.l',
              ignore: 'pid,hostname,service,env,version',
              messageFormat: '{context} {msg}',
            },
          },
        }
      : {}),
  });
}

/**
 * Whether `pino-pretty` can actually be loaded.
 *
 * It is a **dev** dependency, so it is absent from the pruned production
 * image — and a container running with `NODE_ENV=development`, which the local
 * compose stack legitimately does, would otherwise ask pino for a transport
 * that is not installed and die on the first line it tries to log.
 *
 * Pretty output is a convenience. Falling back to JSON is the correct
 * degradation; refusing to start because the logs would be less pleasant to
 * read is not.
 */
function prettyIsAvailable(): boolean {
  try {
    require.resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

/**
 * Adapts pino to Nest's LoggerService.
 *
 * The correlation id is read from async-local storage on every call rather
 * than passed in, because the code that logs is usually three layers below the
 * code that knows the request exists — and threading a context object through
 * those layers is exactly the kind of ceremony that gets skipped.
 */
export class NestPinoLogger implements LoggerService {
  constructor(private readonly root: PinoLogger) {}

  private write(
    level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal',
    message: unknown,
    ...optional: unknown[]
  ): void {
    const context = typeof optional.at(-1) === 'string' ? optional.at(-1) : undefined;
    const correlationId = currentCorrelationId();

    const bindings: Record<string, unknown> = {};
    if (context) bindings['context'] = context;
    if (correlationId) bindings['correlationId'] = correlationId;

    // A thrown Error arrives here as the second argument (Nest passes the
    // stack as a string). Both shapes end up on `err`, so log processors that
    // understand pino's error serialiser keep working.
    const extras = context ? optional.slice(0, -1) : optional;
    const [first] = extras;
    if (first instanceof Error) {
      bindings['err'] = first;
    } else if (typeof first === 'string' && level === 'error') {
      bindings['stack'] = first;
    }

    this.root[level](bindings, stringify(message));
  }

  log(message: unknown, ...optional: unknown[]): void {
    this.write('info', message, ...optional);
  }

  error(message: unknown, ...optional: unknown[]): void {
    this.write('error', message, ...optional);
  }

  warn(message: unknown, ...optional: unknown[]): void {
    this.write('warn', message, ...optional);
  }

  debug(message: unknown, ...optional: unknown[]): void {
    this.write('debug', message, ...optional);
  }

  verbose(message: unknown, ...optional: unknown[]): void {
    this.write('trace', message, ...optional);
  }

  fatal(message: unknown, ...optional: unknown[]): void {
    this.write('fatal', message, ...optional);
  }

  setLogLevels(_levels: LogLevel[]): void {
    // Level is configuration (LOG_LEVEL), validated at boot. Letting the
    // framework raise it at runtime would mean the level in the container's
    // environment and the level actually in force could differ, which is a
    // confusing thing to discover during an incident.
  }
}

function stringify(message: unknown): string {
  if (typeof message === 'string') return message;
  if (message instanceof Error) return message.message;
  try {
    return JSON.stringify(message);
  } catch {
    return String(message);
  }
}
