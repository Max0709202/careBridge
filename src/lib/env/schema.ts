import { z } from "zod";

/**
 * Environment schemas live apart from the modules that read `process.env` so
 * they can be unit tested without pulling in `server-only`.
 *
 * Rule of thumb: if a value is secret it belongs in `serverEnvSchema` and must
 * never be prefixed `NEXT_PUBLIC_`.
 */

export const clientEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
  NEXT_PUBLIC_APP_NAME: z.string().min(1).default("CareBridge"),
  /** Supabase project URL and anon key are public by design; Row Level
   *  Security protects the data, not the secrecy of these two values. */
  NEXT_PUBLIC_SUPABASE_URL: z.url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  /** An absent DSN keeps Sentry disabled. */
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;

/**
 * Integration credentials are all optional. When absent, the corresponding
 * integration falls back to its local development adapter, which logs a safe,
 * redacted message instead of contacting a third party.
 */
export const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    /** Deployment tier, kept separate from NODE_ENV so a production build can
     *  target staging without pretending to be development. */
    APP_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),

    /* --- Database / Supabase (becomes required in Phase 2) --- */
    DATABASE_URL: z.string().min(1).optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

    /* --- Payments (Stripe) --- */
    STRIPE_SECRET_KEY: z.string().min(1).optional(),
    STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),

    /* --- SMS (Twilio) --- */
    TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
    TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
    TWILIO_FROM_NUMBER: z.string().min(1).optional(),

    /* --- Email (Resend) --- */
    RESEND_API_KEY: z.string().min(1).optional(),
    EMAIL_FROM: z.email().optional(),

    /* --- Observability --- */
    SENTRY_DSN: z.string().optional(),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  })
  .superRefine((value, ctx) => {
    if (value.APP_ENV !== "production") return;

    for (const key of ["DATABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
      if (!value[key]) {
        ctx.addIssue({ code: "custom", path: [key], message: `${key} is required in production` });
      }
    }

    // A live secret key with no webhook secret means unverifiable webhooks.
    if (Boolean(value.STRIPE_SECRET_KEY) !== Boolean(value.STRIPE_WEBHOOK_SECRET)) {
      ctx.addIssue({
        code: "custom",
        path: ["STRIPE_WEBHOOK_SECRET"],
        message: "STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must be set together",
      });
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/**
 * Formats a Zod failure into something safe to put in a log or an error
 * message: variable names and rule messages only, never values.
 */
export function describeEnvIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}
