/**
 * Failure types, mirroring packages/dart/carebridge_client/lib/src/failures.dart.
 *
 * User-facing messages are deliberately generic. "Not found" and "not
 * permitted" carry the *same* message so an error cannot be used to probe for
 * the existence of a patient record.
 */

const shared = 'We could not find that, or you do not have access to it.';

export type FailureKind =
  | 'validation'
  | 'authentication'
  | 'authorization'
  | 'notFound'
  | 'invalidTransition'
  | 'rateLimited'
  | 'network';

export class Failure extends Error {
  constructor(
    readonly kind: FailureKind,
    /** Safe to show to a user. Never contains names, addresses or ids. */
    message: string,
    readonly field?: string,
    /** Seconds, from `Retry-After`. Only set on a rate-limited failure. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'Failure';
  }
}

export const validationFailure = (message: string, field?: string) =>
  new Failure('validation', message, field);

export const authenticationFailure = (message = 'Please sign in again.') =>
  new Failure('authentication', message);

export const notFoundFailure = () => new Failure('notFound', shared);

export const networkFailure = (
  message = 'We could not reach CareBridge. Check your connection.',
) => new Failure('network', message);

/**
 * The server's error envelope, mapped onto the failure kinds — the single
 * implementation, as in error_mapping.dart. The API answers "no such record"
 * and "not yours" identically on purpose; this must never re-derive a
 * distinction between them.
 */
export function failureFromResponse(
  status: number,
  body: unknown,
  headers: Headers,
): Failure {
  const error =
    body && typeof body === 'object' && 'error' in body
      ? ((body as { error?: Record<string, unknown> }).error ?? undefined)
      : undefined;
  const message = typeof error?.message === 'string' ? error.message : undefined;
  const code = typeof error?.code === 'string' ? error.code : undefined;
  const field = typeof error?.field === 'string' ? error.field : undefined;

  switch (code) {
    case 'validation':
      return new Failure(
        'validation',
        message ?? 'That request could not be processed.',
        field,
      );
    case 'authentication':
      return authenticationFailure(message ?? 'Please sign in again.');
    case 'not_found_or_forbidden':
      return notFoundFailure();
    case 'invalid_transition':
      return new Failure(
        'invalidTransition',
        'That change is not available right now.',
      );
    case 'conflict':
      return new Failure(
        'validation',
        message ?? 'That conflicts with something else.',
      );
    case 'rate_limited':
      return new Failure(
        'rateLimited',
        message ?? 'Too many attempts. Please wait and try again.',
        undefined,
        retryAfterFrom(headers),
      );
  }

  // No recognised code: fall back to the status, which is what an older client
  // meeting a newer server sees.
  switch (status) {
    case 400:
      return new Failure(
        'validation',
        message ?? 'That request could not be processed.',
      );
    case 401:
      return authenticationFailure();
    case 403:
    case 404:
      return notFoundFailure();
    case 429:
      return new Failure(
        'rateLimited',
        'Too many attempts. Please wait and try again.',
        undefined,
        retryAfterFrom(headers),
      );
    default:
      return networkFailure(
        message ?? 'Something went wrong on our side. Please try again.',
      );
  }
}

/** `Retry-After`, in seconds; undefined when absent or unparseable. */
export function retryAfterFrom(headers: Headers): number | undefined {
  const seconds = Number.parseInt(headers.get('retry-after') ?? '', 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

/**
 * The user-safe text for anything thrown. Only a [Failure]'s message is ever
 * surfaced; an unexpected exception's text belongs in a log, not on a screen.
 */
export function failureMessage(error: unknown): string {
  return error instanceof Failure
    ? error.message
    : 'Something went wrong. Please try again.';
}
