/**
 * Injection token for the raw pino logger.
 *
 * Most code should keep using Nest's `Logger`, which is wired to the same pino
 * instance. This token exists for the few places that need structured
 * key–value logging directly — the request logger, and the queue workers,
 * which have no Nest execution context to hang a `Logger` on.
 */
export const LOGGER = Symbol('LOGGER');
