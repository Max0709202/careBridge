import "server-only";

import { clientEnv } from "./client";
import { describeEnvIssues, serverEnvSchema, type ServerEnv } from "./schema";

/**
 * Server configuration. May contain secrets, and therefore must never be
 * imported from a Client Component. The `server-only` import above turns that
 * mistake into a build error rather than a leak.
 */
const parsed = serverEnvSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Invalid server environment configuration. ${describeEnvIssues(parsed.error)}`);
}

export const serverEnv: ServerEnv = parsed.data;

/**
 * Which integrations have real credentials. Adapters read this to choose
 * between the live client and the local development adapter, so that "no
 * credentials configured" is a supported state rather than a crash.
 */
export const integrationStatus = {
  database: Boolean(serverEnv.DATABASE_URL),
  supabase: Boolean(clientEnv.NEXT_PUBLIC_SUPABASE_URL && clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  stripe: Boolean(serverEnv.STRIPE_SECRET_KEY && serverEnv.STRIPE_WEBHOOK_SECRET),
  sms: Boolean(
    serverEnv.TWILIO_ACCOUNT_SID && serverEnv.TWILIO_AUTH_TOKEN && serverEnv.TWILIO_FROM_NUMBER,
  ),
  email: Boolean(serverEnv.RESEND_API_KEY && serverEnv.EMAIL_FROM),
  sentry: Boolean(serverEnv.SENTRY_DSN),
} as const;

export type IntegrationStatus = typeof integrationStatus;
