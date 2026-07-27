import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { integrationStatus } from "@/lib/env/server";
import { SignUpForm } from "@/modules/auth/components/sign-up-form";
import { ROLE_HOME } from "@/modules/auth/domain/roles";
import { getAuthContext } from "@/server/authz";

export const metadata: Metadata = { title: "Create an account" };

export default async function SignUpPage() {
  if (integrationStatus.supabase) {
    const ctx = await getAuthContext();
    if (ctx) redirect(ROLE_HOME[ctx.role]);
  }

  return (
    <div className="mx-auto max-w-md px-5 py-16 sm:py-24">
      <h1 className="text-3xl">Create a family account</h1>
      <p className="mt-3 text-muted-foreground">
        A family account lets you add the person you are helping and send us their appointment.
      </p>

      <Alert className="mt-6">
        <AlertTitle>Please use fictional details</AlertTitle>
        <AlertDescription>
          CareBridge is a pre-release MVP. Do not enter real personal or health information.
        </AlertDescription>
      </Alert>

      {integrationStatus.supabase ? (
        <div className="mt-8">
          <SignUpForm />
        </div>
      ) : (
        <Alert className="mt-8" variant="destructive">
          <AlertTitle>Sign-up is not available in this environment</AlertTitle>
          <AlertDescription>
            Registration requires the local Supabase stack. See docs/DATABASE.md.
          </AlertDescription>
        </Alert>
      )}

      <p className="mt-8 text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          href="/sign-in"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
