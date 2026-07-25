"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/**
 * Global error boundary.
 *
 * Deliberately shows a generic message. `error.message` from a server
 * component is scrubbed by Next in production, but relying on that would be
 * fragile — an error message can carry record contents or upstream API
 * details, and neither belongs on screen. The `digest` is safe: it is an
 * opaque id that maps to the full, unredacted entry in the server log.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Server-side reporting happens in the server log. This is only so a
    // developer with the console open is not left guessing.
    if (process.env.NODE_ENV === "development") {
      // eslint-disable-next-line no-console
      console.error(error);
    }
  }, [error]);

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-16 text-center">
      <h1 className="text-3xl">Something went wrong</h1>
      <p className="mt-4 text-muted-foreground">
        We hit a problem loading this page. Nothing you entered has been lost. Please try again.
      </p>
      <div className="mt-8 flex flex-col gap-3">
        <Button onClick={reset}>Try again</Button>
      </div>
      {error.digest ? (
        <p className="mt-8 text-sm text-muted-foreground">
          Reference code: <span className="font-mono">{error.digest}</span>
        </p>
      ) : null}
    </div>
  );
}
