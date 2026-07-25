import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-16 text-center">
      <h1 className="text-3xl">Page not found</h1>
      <p className="mt-4 text-muted-foreground">
        The page you were looking for isn&apos;t here. It may have moved, or you may not have access
        to it.
      </p>
      <div className="mt-8">
        <Button asChild>
          <Link href="/">Back to home</Link>
        </Button>
      </div>
    </div>
  );
}
