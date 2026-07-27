"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { toUserMessage } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { ROLE_HOME, isRole } from "@/modules/auth/domain/roles";
import { AuditAction, writeAuditEvent } from "@/server/audit";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { signInSchema, signUpSchema, type AuthActionResult } from "./schemas";

/**
 * Authentication server actions.
 *
 * Each validates its input with Zod on the server, performs the Supabase auth
 * call, writes an audit event, and redirects on success. Failures return a
 * generic message; details go to the server log only. A caller can never set
 * their own role here — self-service signup is always FAMILY (enforced by the
 * database trigger, which reads role from server-controlled app_metadata).
 */

async function roleHomeFor(userId: string): Promise<string> {
  const profile = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (profile && isRole(profile.role)) return ROLE_HOME[profile.role];
  return "/";
}

export async function signInAction(input: unknown): Promise<AuthActionResult> {
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) return { error: "Enter a valid email and password." };

  let destination: string;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });

    if (error || !data.user) {
      // Deliberately uniform: never reveal whether the email exists.
      logger.warn("Sign-in failed", { reason: error?.message });
      return { error: "Those sign-in details did not match. Please try again." };
    }

    await writeAuditEvent({
      actorId: data.user.id,
      action: AuditAction.USER_SIGNED_IN,
      entityType: "user",
      entityId: data.user.id,
    });
    destination = await roleHomeFor(data.user.id);
  } catch (error) {
    logger.error("Sign-in error", { error });
    return { error: toUserMessage(error) };
  }

  redirect(destination);
}

export async function signUpAction(input: unknown): Promise<AuthActionResult> {
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form and try again." };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        // user_metadata only — never role. The trigger ignores this for role.
        data: {
          ...(parsed.data.displayName ? { display_name: parsed.data.displayName } : {}),
          ...(parsed.data.accountName ? { account_name: parsed.data.accountName } : {}),
        },
      },
    });

    if (error || !data.user) {
      logger.warn("Sign-up failed", { reason: error?.message });
      return { error: "We could not create the account. Please try again." };
    }

    await writeAuditEvent({
      actorId: data.user.id,
      action: AuditAction.USER_REGISTERED,
      entityType: "user",
      entityId: data.user.id,
    });

    // With email confirmation off (local dev) a session exists immediately.
    // With it on, there is no session yet; ask them to confirm.
    if (!data.session) {
      return { notice: "Check your email to confirm your account, then sign in." };
    }
  } catch (error) {
    logger.error("Sign-up error", { error });
    return { error: toUserMessage(error) };
  }

  redirect(ROLE_HOME.FAMILY);
}

export async function signOutAction(): Promise<void> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase.auth.signOut();
    if (user) {
      await writeAuditEvent({
        actorId: user.id,
        action: AuditAction.USER_SIGNED_OUT,
        entityType: "user",
        entityId: user.id,
      });
    }
  } catch (error) {
    logger.error("Sign-out error", { error });
  }
  redirect("/");
}
