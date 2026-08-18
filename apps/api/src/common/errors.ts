/**
 * Failure types shared across modules. Mirrors lib/core/failures.dart.
 *
 * `AuthorizationError` and `NotFoundError` carry the *same* user-visible
 * message and the same HTTP status, so a caller cannot distinguish "this record
 * does not exist" from "you may not see it" — otherwise the error itself
 * becomes a way to probe for the existence of a patient record.
 */

export type FailureCode =
  | 'validation'
  | 'authentication'
  | 'not_found_or_forbidden'
  | 'invalid_transition'
  | 'conflict'
  | 'rate_limited'
  | 'internal';

export class AppError extends Error {
  constructor(
    readonly code: FailureCode,
    message: string,
    readonly status: number,
    readonly field?: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, field?: string) {
    super('validation', message, 400, field);
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Please sign in again.') {
    super('authentication', message, 401);
  }
}

/**
 * The shared message. Deliberately identical to NotFoundError's, and returned
 * with the same 404 — see the note at the top of this file.
 */
const SHARED = 'We could not find that, or you do not have access to it.';

export class AuthorizationError extends AppError {
  constructor() {
    super('not_found_or_forbidden', SHARED, 404);
  }
}

export class NotFoundError extends AppError {
  constructor() {
    super('not_found_or_forbidden', SHARED, 404);
  }
}

/**
 * Raised when a caller attempts a status change the state machine forbids.
 * `from` and `to` are kept for the server log; the user-visible message says
 * nothing about them.
 */
export class InvalidTransitionError extends AppError {
  constructor(
    readonly from: string,
    readonly to: string,
  ) {
    super('invalid_transition', 'That change is not available right now.', 409);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super('conflict', message, 409);
  }
}

/**
 * Too many attempts. Carries how long to wait so the filter can send
 * `Retry-After` — a client that is told to back off but not for how long
 * either retries immediately or gives up entirely, and both are worse than
 * being told.
 *
 * The message never says which limit was hit or what the counter is keyed on.
 * "Too many attempts for this email address" would confirm the address exists,
 * which is exactly what the sign-in and reset endpoints refuse to do
 * everywhere else.
 */
export class RateLimitError extends AppError {
  constructor(readonly retryAfterSeconds: number) {
    super('rate_limited', 'Too many attempts. Please wait and try again.', 429);
  }
}
