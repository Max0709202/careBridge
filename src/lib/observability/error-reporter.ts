import "server-only";

import { integrationStatus } from "@/lib/env/server";
import { logger } from "@/lib/logger";
import { redactMetadata } from "@/lib/logger/redact";

/**
 * Error reporting seam.
 *
 * Sentry is *prepared* but deliberately not wired to its SDK yet: with no DSN
 * configured there is nothing to send, and installing the SDK early would add
 * build weight and a second redaction surface to audit. Phase 7 replaces the
 * body of `reportError` with a Sentry call; every call site stays unchanged.
 *
 * Whatever the backend, context is redacted first. An error tracker is still a
 * third party.
 */

export interface ErrorContext {
  /** Coarse area of the app, e.g. "service-requests.create". Never free text
   *  taken from user input. */
  scope: string;
  /** Actor performing the action, by opaque id only - never name or email. */
  actorId?: string;
  /** Additional structured detail. Passed through redaction. */
  metadata?: Record<string, unknown>;
}

export function reportError(error: unknown, context: ErrorContext): void {
  const payload = {
    scope: context.scope,
    ...(context.actorId ? { actorId: context.actorId } : {}),
    ...(context.metadata ? redactMetadata(context.metadata) : {}),
    error,
  };

  if (integrationStatus.sentry) {
    // Phase 7: forward to Sentry here. Until then, never silently drop it.
    logger.error("Unhandled error (Sentry SDK not yet wired; see Phase 7)", payload);
    return;
  }

  logger.error("Unhandled error (error reporting disabled: no SENTRY_DSN)", payload);
}
