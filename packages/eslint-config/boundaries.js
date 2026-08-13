/**
 * Module-boundary rules for the modular monolith.
 *
 * The monolith is only extractable if its modules stay separable, and the way
 * that erodes is not a big architectural decision — it is one service quietly
 * importing another module's Prisma repository because the data was right
 * there. These rules make that a lint error rather than a code-review memory
 * test.
 *
 * What is allowed between modules is the *service* and its exported types.
 * What is not allowed is reaching past it into `data/`, `domain/` internals or
 * another module's DTO folder. See docs/adr/0001-modular-monolith.md.
 */

/** Files under src/modules/<name>/ may not deep-import a sibling module. */
export const crossModuleImports = {
  files: ['**/src/modules/**/*.ts'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['**/modules/*/data/*', '**/modules/*/*.repository'],
            message:
              "A module's repositories are private to it. Depend on the sibling module's exported service instead — that is the seam the module gets extracted along.",
          },
          {
            group: ['../../modules/*/dto/*'],
            message:
              "Another module's DTOs are its wire contract, not a shared type library. Define what you need in your own module or lift it into src/domain.",
          },
        ],
      },
    ],
  },
};

/**
 * Infrastructure adapters are reachable only through their port interface.
 * `modules/` talks to `MailPort`, never to `SmtpMailAdapter` — otherwise the
 * "vendor behind an interface" promise in FOUNDATION §4 is decorative.
 */
export const infrastructureImports = {
  files: ['**/src/modules/**/*.ts'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['**/infrastructure/*/*.adapter', '**/infrastructure/*/adapters/*'],
            message:
              'Import the port (the interface + its injection token), not a concrete adapter. Which adapter is live is a configuration decision, made once in the infrastructure module.',
          },
        ],
      },
    ],
  },
};

/**
 * Pure domain code stays pure: no Nest, no Prisma, no I/O. It is the layer we
 * can test exhaustively precisely because nothing in it can reach the network.
 */
export const domainPurity = {
  files: ['**/src/domain/**/*.ts', '**/src/modules/*/domain/**/*.ts'],
  // Specs are excluded below: a domain test may legitimately compare its
  // model against the schema enum it is supposed to mirror, and that
  // comparison is the whole value of the test.
  ignores: ['**/*.spec.ts'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        paths: [
          {
            name: '@prisma/client',
            message:
              'Domain code models rules, not rows. Map to a domain type at the repository boundary.',
          },
          {
            name: '@nestjs/common',
            message:
              'Domain code must be constructible without a DI container — that is what makes the state machines exhaustively testable.',
          },
        ],
        patterns: [
          {
            group: ['**/infrastructure/**', '**/modules/**'],
            message: 'Domain code may not depend on infrastructure or modules.',
          },
        ],
      },
    ],
  },
};
