import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';

import {
  crossModuleImports,
  domainPurity,
  infrastructureImports,
} from './boundaries.js';

/**
 * The shared flat config.
 *
 * Two bans here are load-bearing rather than stylistic, and both exist because
 * the alternative is "remember to do the right thing at every call site":
 *
 *   - `process.env` is readable in exactly one file. Everywhere else a typo in
 *     an env name silently becomes `undefined` and surfaces as a runtime bug
 *     hours later, in production, on the one code path nobody exercised.
 *   - `console` is banned because it bypasses the pino redaction denylist.
 *     A single `console.log(user)` puts a name, an email and a phone number
 *     into CloudWatch, where they are now subject to the retention policy of
 *     a log group nobody classified.
 */
export function carebridgeConfig({ tsconfigRootDir, project } = {}) {
  return tseslint.config(
    {
      ignores: [
        '**/dist/**',
        '**/node_modules/**',
        '**/build/**',
        '**/.dart_tool/**',
        '**/generated/**',
        'packages/dart/**',
      ],
    },
    eslint.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    {
      languageOptions: {
        globals: { ...globals.node },
        parserOptions: {
          project: project ?? true,
          tsconfigRootDir,
        },
      },
      plugins: { import: importPlugin },
      rules: {
        'no-console': 'error',

        'no-restricted-properties': [
          'error',
          {
            object: 'process',
            property: 'env',
            message:
              'Read configuration through the validated AppConfig (src/common/config.ts). It is the only file allowed to touch process.env, and it fails the container’s first second rather than the first request.',
          },
        ],

        '@typescript-eslint/no-floating-promises': 'error',
        '@typescript-eslint/no-misused-promises': 'error',
        '@typescript-eslint/consistent-type-imports': [
          'error',
          { fixStyle: 'inline-type-imports', disallowTypeAnnotations: false },
        ],
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
        '@typescript-eslint/require-await': 'off',
        '@typescript-eslint/no-explicit-any': 'error',

        'import/no-cycle': ['error', { maxDepth: 4 }],
        'import/no-default-export': 'error',
      },
    },
    crossModuleImports,
    infrastructureImports,
    domainPurity,
    {
      // Flat-config and script files are not in any tsconfig, and putting them
      // there only to satisfy the parser would drag them into the build.
      files: ['**/*.mjs', '**/*.cjs', '**/*.js'],
      ...tseslint.configs.disableTypeChecked,
    },
    {
      // The one file that may read the environment, and the one that may
      // print before the logger exists.
      files: ['**/src/common/config.ts', '**/scripts/**', '**/*.mjs'],
      rules: {
        'no-restricted-properties': 'off',
        'no-console': 'off',
        'import/no-default-export': 'off',
      },
    },
    {
      files: ['**/*.spec.ts', '**/test/**/*.ts', '**/prisma/seed.ts'],
      rules: {
        'no-restricted-properties': 'off',
        'no-console': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
      },
    },
  );
}
