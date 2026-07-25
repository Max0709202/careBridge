import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const baseURL = `http://127.0.0.1:${PORT}`;

/**
 * End-to-end tests run against a production build on a dedicated port, so a
 * developer's `pnpm dev` session on 3000 is never disturbed and the tests
 * exercise the same code path that ships.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // Only pin worker count in CI; locally, let Playwright choose. Spread avoids
  // assigning `undefined` under exactOptionalPropertyTypes.
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    // Build with webpack rather than Turbopack: the webpack output is portable
    // across CPUs, whereas Turbopack's prebuilt native binary refuses to run on
    // some virtualized/older hardware (illegal-instruction crash). e2e tests
    // exercise app behaviour, not the bundler, so the portable path is correct
    // here. Production `pnpm build` still uses the Next default (Turbopack).
    // Override with E2E_BUILD_CMD if a different pipeline is needed.
    command:
      process.env.E2E_BUILD_CMD ??
      `pnpm exec next build --webpack && pnpm exec next start --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: {
      NEXT_PUBLIC_APP_URL: baseURL,
      APP_ENV: "test",
    },
  },
});
