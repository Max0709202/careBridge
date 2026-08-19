/**
 * The redaction denylist, applied **at the logger** rather than at call sites.
 *
 * This placement is the whole point. A denylist enforced by remembering to
 * scrub before each `log()` call fails the first time someone logs a whole
 * object during a 2am incident — which is exactly when the most sensitive
 * objects are being logged. Applied here, `logger.info({ user }, 'updated')`
 * emits `[redacted]` for the name, the email and the phone without the caller
 * knowing the list exists.
 *
 * pino's `redact` takes JSONPath-ish expressions and walks them on the way
 * out, so the cost is paid only for the paths that actually appear.
 *
 * What is on the list is driven by FOUNDATION §9 and the sensitivity
 * classification in docs/privacy/data-map.md: identity, contact details,
 * location, and anything that is a credential.
 */

/** Field names that must never reach a log sink, at any depth we bind. */
const SENSITIVE_FIELDS = [
  // Identity and contact
  'email',
  'emailAddress',
  'phone',
  'phoneNumber',
  'fullName',
  'name',
  // Billing addresses are email addresses. pino's path matching is exact, so
  // an alias of `email` has to be named or it walks straight through.
  'billingEmail',
  'contactEmail',
  'legalName',
  'preferredName',
  'displayName',
  'firstName',
  'lastName',

  // Address
  'line1',
  'line2',
  'postalCode',
  'address',
  'accessNotes',

  // Location. A coordinate pair is a person's position at a moment in time;
  // in this product it is often a patient's, in a vehicle, mid-journey.
  'latitude',
  'longitude',
  'lat',
  'lng',
  'coordinates',

  // Dates of birth are not stored (FOUNDATION §9) — listed anyway, so that if
  // one ever arrives from a third party it does not land in a log first.
  'dateOfBirth',
  'dob',
  'birthDate',

  // Credentials and tokens
  'password',
  'passwordHash',
  'currentPassword',
  'newPassword',
  'token',
  'accessToken',
  'refreshToken',
  'tokenHash',
  'secret',
  'totpSecret',
  'apiKey',
  'authorization',
  'cookie',
  'setCookie',

  // Payment. Card data never touches this server by design; if it ever does,
  // it does not also touch the log.
  'cardNumber',
  'cvc',
  'cvv',
  'iban',

  // Free text a person typed about another person.
  'mobilityNotes',
  'coordinationNotes',
  'notesForDriver',
];

/**
 * The object prefixes a sensitive field can plausibly hang off.
 *
 * pino requires literal paths — it does not support a recursive wildcard — so
 * the set of prefixes is enumerated rather than inferred. `*` covers one level
 * of arrays and maps, which is what `req.body.patients[0].phone` needs.
 */
const PREFIXES = [
  '',
  'req.body.',
  'req.query.',
  'req.params.',
  'req.headers.',
  'res.headers.',
  'user.',
  'patient.',
  'driver.',
  'clinic.',
  'ride.',
  'organization.',
  'subscription.',
  'billingAccount.',
  'account.',
  'appointment.',
  'contact.',
  'data.',
  'payload.',
  'input.',
  'result.',
  'err.',
  'error.',
  '*.',
  '*.*.',
];

export const REDACTION_PATHS: string[] = [
  ...new Set(
    PREFIXES.flatMap((prefix) => SENSITIVE_FIELDS.map((field) => `${prefix}${field}`)),
  ),
  // Header casing varies by client, and pino's path matching is exact.
  'req.headers["authorization"]',
  'req.headers["x-api-key"]',
  'req.headers["proxy-authorization"]',
];

export const REDACTION_CENSOR = '[redacted]';

/** Exported for the test that asserts the list has not silently shrunk. */
export const SENSITIVE_FIELD_NAMES: readonly string[] = SENSITIVE_FIELDS;
