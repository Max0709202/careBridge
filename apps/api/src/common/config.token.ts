/**
 * Injection token for the validated configuration.
 *
 * Separate from `config.ts` so that importing the token never drags the zod
 * schema (and its validation side effects) into a consumer.
 */
export const APP_CONFIG = Symbol('APP_CONFIG');
