import type { Metadata } from "next";
import Link from "next/link";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Create an account" };

/**
 * Placeholder. Registration, role assignment and family-account creation are
 * built in Phase 2.
 */
export default function SignUpPage() {
  return (
    <div className="mx-auto max-w-md px-5 py-16 sm:py-24">
      <h1 className="text-3xl">Create an account</h1>
      <p className="mt-4 text-muted-foreground">
        A family account lets you add the person you are helping and send us their appointment.
      </p>

      <Alert className="mt-8">
        <AlertTitle>Not open yet</AlertTitle>
        <AlertDescription>
          CareBridge is in development and is not accepting sign-ups. Please do not submit real
          personal or health information anywhere in this application.
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
