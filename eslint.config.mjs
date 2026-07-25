import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

/**
 * Architectural boundaries are enforced here, not by convention alone.
 * See CLAUDE.md -> "Architecture conventions" for the reasoning behind each rule.
 */

/** Database / server-infrastructure imports that must never reach the browser bundle. */
const SERVER_ONLY_PATHS = [
  {
    group: ["@/server/*", "@/server/**"],
    message:
      "Server infrastructure (db, authz, audit) must not be imported from UI components. Fetch in a Server Component or a server action and pass plain data down.",
  },
  {
    group: ["drizzle-orm", "drizzle-orm/*", "postgres", "pg"],
    message: "Database drivers must not be imported from UI components.",
  },
  {
    group: ["@/lib/env/server", "@/lib/env/server.*"],
    message: "Server environment holds secrets. Use @/lib/env/client in UI components.",
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  {
    rules: {
      // Structured, redacting logger only. Raw console output risks leaking PII.
      "no-console": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-restricted-syntax": [
        "error",
        {
          // Block every process.env.* read EXCEPT process.env.NODE_ENV, which
          // Next.js inlines as a build-time constant and which is not config
          // or a secret. Everything else must go through the validated env.
          selector:
            "MemberExpression[object.object.name='process'][object.property.name='env']:not([property.name='NODE_ENV'])",
          message:
            "Do not read process.env directly. Import the validated config from @/lib/env/server or @/lib/env/client.",
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },

  // UI components are potentially client-side. Keep infrastructure out of them.
  {
    files: ["src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: SERVER_ONLY_PATHS }],
    },
  },

  // Domain layers hold pure business rules: no framework, no I/O, no React.
  // This is what makes them cheap to unit test.
  {
    files: ["src/modules/*/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...SERVER_ONLY_PATHS,
            {
              group: ["react", "react-dom", "next", "next/*"],
              message: "Domain rules must stay framework-free and pure.",
            },
          ],
        },
      ],
    },
  },

  // The env modules are the single sanctioned place to read process.env.
  {
    files: ["src/lib/env/*.ts"],
    rules: { "no-restricted-syntax": "off" },
  },

  // Config, scripts and tests may use process.env and console output.
  {
    files: [
      "*.config.{ts,mts,js,mjs}",
      "scripts/**/*.{ts,mts}",
      "tests/**/*.{ts,tsx}",
      "src/**/*.test.{ts,tsx}",
    ],
    rules: {
      "no-console": "off",
      "no-restricted-syntax": "off",
      "no-restricted-imports": "off",
    },
  },

  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
  ]),

  // Must stay last: turns off rules that conflict with Prettier formatting.
  prettier,
]);

export default eslintConfig;
