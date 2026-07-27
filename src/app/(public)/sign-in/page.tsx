import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { integrationStatus } from "@/lib/env/server";
import { SignInForm } from "@/modules/auth/components/sign-in-form";
import { ROLE_HOME } from "@/modules/auth/domain/roles";
import { getAuthContext } from "@/server/authz";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage() {
  // Already signed in? Send them to their home. Skipped when auth is not
  // configured (e.g. a build without Supabase credentials).
  if (integrationStatus.supabase) {
    const ctx = await getAuthContext();
    if (ctx) redirect(ROLE_HOME[ctx.role]);
  }

  return (
    <div className="mx-auto max-w-md px-5 py-16 sm:py-24">
      <h1 className="text-3xl">Sign in</h1>
      <p className="mt-3 text-muted-foreground">
        Sign in to see the status of your family&apos;s requests.
      </p>

      {integrationStatus.supabase ? (
        <div className="mt-8">
          <SignInForm />
        </div>
      ) : (
        <Alert className="mt-8">
          <AlertTitle>Sign-in is not available in this environment</AlertTitle>
          <AlertDescription>
            Authentication requires the local Supabase stack. See docs/DATABASE.md.
          </AlertDescription>
        </Alert>
      )}

      <p className="mt-8 text-sm text-muted-foreground">
        New to CareBridge?{" "}
        <Link
          href="/sign-up"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}
