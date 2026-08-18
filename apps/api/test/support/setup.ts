import 'reflect-metadata';

/**
 * The environment every integration test runs under.
 *
 * Set here rather than in each file so that no test can accidentally run
 * against a developer's real `.env` — the suite truncates tables, and a
 * misconfigured `DATABASE_URL` would truncate the wrong ones.
 */
process.env['NODE_ENV'] = 'test';
process.env['JWT_SECRET'] ??= 'integration-tests-only-secret-at-least-32-chars';
process.env['DATABASE_URL'] ??=
  'postgresql://carebridge:carebridge-local-dev@127.0.0.1:55432/carebridge_test?schema=public';

// Every outbound adapter is a local one. A test that sends a real email is a
// test that eventually sends one to a real person.
process.env['MAIL_DRIVER'] = 'log';
process.env['PUSH_DRIVER'] = 'log';
process.env['MAPS_DRIVER'] = 'deterministic';

// Redis is used when it is offered and skipped when it is not.
//
// The suite passes either way, and that is the point rather than a
// convenience: what it asserts on is the *rows* — that a reminder exists, that
// it is re-armed at boot, that it fires once — and those are true whichever
// scheduler is behind the port. Running it both ways is what proves the two
// adapters are actually interchangeable, which is the whole claim the port
// makes.
//
//   pnpm test:integration                      → in-process scheduler
//   REDIS_URL=redis://127.0.0.1:56379 pnpm …   → the real BullMQ adapter
if (!process.env['REDIS_URL']) delete process.env['REDIS_URL'];

process.env['LOG_LEVEL'] = 'silent';
process.env['LOG_PRETTY'] = 'false';

// MFA enrolment refuses to store a secret without this key, and rightly so —
// so a suite that leaves it unset can only ever test the refusal. A fixed
// all-zero key is fine here and nowhere else: it never leaves this process,
// and the tests assert on behaviour rather than on ciphertext.
process.env['MFA_SECRET_KEY'] ??= Buffer.alloc(32).toString('base64');

// Rate limits, effectively off.
//
// Every fixture in this suite is built through the HTTP API, and every request
// in a run arrives from the same loopback address — so the per-IP counters
// would see one caller registering forty accounts and refuse, which is the
// limit working correctly and telling us nothing about the code under test.
//
// `??=`, not `=`: rate-limit.e2e-spec.ts sets its own tight values before the
// harness boots, which is where the limits themselves are proven.
process.env['LOGIN_MAX_ATTEMPTS'] ??= '10000';
process.env['SIGN_IN_IP_MAX_ATTEMPTS'] ??= '10000';
process.env['EMAIL_DISPATCH_MAX_ATTEMPTS'] ??= '10000';
process.env['TOKEN_GUESS_MAX_ATTEMPTS'] ??= '10000';

// Short, so an expiry test does not have to wait.
process.env['PASSWORD_RESET_TTL_MINUTES'] ??= '30';
process.env['INVITATION_TTL_DAYS'] ??= '7';
