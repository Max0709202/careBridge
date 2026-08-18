/**
 * Unit tests: pure, parallel, no I/O. The integration suite is
 * jest.integration.config.js.
 *
 * Moved out of package.json so the coverage thresholds below can say why they
 * are the numbers they are. A threshold with no rationale gets lowered by
 * whoever it first inconveniences.
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  testEnvironment: 'node',

  // Modules, DTOs and tokens are declarations: covering them measures whether
  // Nest can construct a class, which the integration suite proves properly by
  // booting the application. Everything else counts, including the files with
  // no unit tests at all — a coverage report that only looks at what is
  // already tested cannot tell you what is not.
  collectCoverageFrom: [
    '**/*.ts',
    '!**/*.spec.ts',
    '!main.ts',
    '!**/*.module.ts',
    '!**/*.dto.ts',
    '!**/*.token.ts',
    '!**/dto/**',
  ],
  coverageReporters: ['text-summary', 'lcov'],

  coverageThreshold: {
    // The rules the product turns on: state machines, permissions, pricing,
    // TOTP, reminder offsets, location freshness. Pure functions with no
    // excuse for a gap — every one of them is fully covered today, and the
    // threshold is here so that stays true rather than being true by accident.
    //
    // Branches are not at 100 because of `?? 0` fallbacks on indexed reads
    // that `noUncheckedIndexedAccess` requires and nothing can reach.
    './src/domain/': {
      statements: 100,
      branches: 90,
      functions: 100,
      lines: 100,
    },

    // The denylist is the reason a password or a token cannot reach a log
    // line, and it is applied in one place. Untested, it fails silently and
    // for as long as nobody reads the logs.
    './src/common/logging/redaction.ts': {
      statements: 100,
      branches: 100,
      functions: 100,
      lines: 100,
    },

    // A floor, not a target, and it covers what is *left* — jest takes every
    // file matched by a threshold above out of the global group, so this is
    // the services, controllers and adapters with the domain removed.
    //
    // It is low because those are exercised by the integration suite against a
    // real database and that run's coverage is not merged into this one.
    // Reading 10% as "a tenth of this code is tested" would be wrong; what the
    // floor catches is a deletion, tests removed rather than fixed. Raise it
    // when it has been comfortably exceeded for a while.
    global: {
      statements: 10,
      branches: 8,
      functions: 6,
      lines: 10,
    },
  },
};
