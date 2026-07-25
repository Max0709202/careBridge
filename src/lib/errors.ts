/**
 * Application error taxonomy.
 *
 * The rule these types exist to serve: users see a generic, non-leaking
 * message; the server log gets the detail. Anything thrown that is *not* one
 * of these is treated as an internal error and surfaced as "Something went
 * wrong" - never with its message attached, because arbitrary error messages
 * can contain record contents, SQL fragments, or upstream API responses.
 */

export type AppErrorKind =
  | "validation"
  | "authentication"
  | "authorization"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "internal";

export abstract class AppError extends Error {
  abstract readonly kind: AppErrorKind;
  /** Message that is safe to render to an end user. */
  abstract readonly userMessage: string;

  constructor(
    message: string,
    readonly metadata: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Input failed schema or business-rule validation. Safe to explain. */
export class ValidationError extends AppError {
  readonly kind = "validation" as const;
  readonly userMessage: string;

  constructor(userMessage: string, metadata?: Record<string, unknown>) {
    super(userMessage, metadata);
    this.userMessage = userMessage;
  }
}

/** No valid session. */
export class AuthenticationError extends AppError {
  readonly kind = "authentication" as const;
  readonly userMessage = "Please sign in to continue.";
}

/**
 * Authenticated but not permitted.
 *
 * Deliberately indistinguishable from "not found" in the user-facing message,
 * so probing for record ids cannot confirm that a record exists.
 */
export class AuthorizationError extends AppError {
  readonly kind = "authorization" as const;
  readonly userMessage = "You do not have access to this item.";
}

export class NotFoundError extends AppError {
  readonly kind = "not_found" as const;
  readonly userMessage = "You do not have access to this item.";
}

/** The action is not valid for the record's current state. */
export class ConflictError extends AppError {
  readonly kind = "conflict" as const;
  readonly userMessage: string;

  constructor(userMessage: string, metadata?: Record<string, unknown>) {
    super(userMessage, metadata);
    this.userMessage = userMessage;
  }
}

export class RateLimitError extends AppError {
  readonly kind = "rate_limited" as const;
  readonly userMessage = "Too many attempts. Please wait a moment and try again.";
}

export const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

/** Maps any thrown value to a message that is safe to show a user. */
export function toUserMessage(error: unknown): string {
  return error instanceof AppError ? error.userMessage : GENERIC_ERROR_MESSAGE;
}
