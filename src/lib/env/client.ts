import { clientEnvSchema, describeEnvIssues, type ClientEnv } from "./schema";

/**
 * Public configuration. Every value here is inlined into the browser bundle at
 * build time, so NOTHING SECRET MAY EVER BE ADDED HERE.
 *
 * Next.js only inlines statically-written `process.env.NEXT_PUBLIC_*`
 * expressions, which is why each one is spelled out literally below rather
 * than read from a loop.
 */
const parsed = clientEnvSchema.safeParse({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
});

if (!parsed.success) {
  throw new Error(`Invalid public environment configuration. ${describeEnvIssues(parsed.error)}`);
}

export const clientEnv: ClientEnv = parsed.data;
