/**
 * Integration tests: a real NestJS application against a real PostgreSQL.
 *
 * A separate config from the unit suite because these have genuinely different
 * requirements. Unit tests are pure, parallel and take milliseconds; these need
 * a database, must not run concurrently against the same one, and are worth a
 * much longer timeout because argon2 is intentionally slow.
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: 'test/.*\\.e2e-spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  testEnvironment: 'node',
  // argon2id is tuned to take ~50ms per hash, and a registration test does
  // several. A short timeout here fails on the machine, not on the code.
  testTimeout: 60_000,
  setupFilesAfterEnv: ['<rootDir>/test/support/setup.ts'],
  // Serial. Each file truncates the schema between tests, so two files running
  // at once would delete each other's fixtures.
  maxWorkers: 1,
};
