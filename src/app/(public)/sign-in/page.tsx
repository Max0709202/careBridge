import type { Metadata } from "next";
import Link from "next/link";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Sign in" };

/**
 * Placeholder. Real authentication (Supabase Auth, secure cookie session,
 * role-aware redirect) is built in Phase 2. The route exists now so links and
 * typed routes are honest.
 */
export default function SignInPage() {
  return (
    <div className="mx-auto max-w-md px-5 py-16 sm:py-24">
      <h1 className="text-3xl">Sign in</h1>
      <p className="mt-4 text-muted-foreground">
        Sign in to see the status of your family&apos;s requests.
      </p>

      <Alert className="mt-8">
        <AlertTitle>Not available yet</AlertTitle>
        <AlertDescription>
          Accounts are not open. Authentication arrives in the next development phase.
        </AlertDescription>
      </Alert>

      <div className="mt-8 flex flex-col gap-3">
        <Button asChild variant="outline">
          <Link href="/how-it-works">See how CareBridge works</Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/">Back to home</Link>
        </Button>
      </div>
    </div>
  );
}
