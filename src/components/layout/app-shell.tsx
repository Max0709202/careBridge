import Link from "next/link";

import { Button } from "@/components/ui/button";
import { ROLE_LABELS, type Role } from "@/modules/auth/domain/roles";
import { signOutAction } from "@/modules/auth/actions";
import type { NavLink } from "@/lib/site-config";

interface AppShellProps {
  role: Role;
  email: string;
  displayName: string | null;
  nav: readonly NavLink[];
  children: React.ReactNode;
}

/**
 * Shell for signed-in areas. Server Component: the only interactive part is the
 * sign-out control, which is a plain form posting to a server action, so no
 * client JavaScript is required for it to work.
 */
export function AppShell({ role, email, displayName, nav, children }: AppShellProps) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50"
      >
        Skip to main content
      </a>

      <header className="sticky top-0 z-40 border-b border-border bg-background">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              <span className="text-primary">Care</span>Bridge
            </Link>
            <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
              {ROLE_LABELS[role]}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {displayName ?? email}
            </span>
            <form action={signOutAction}>
              <Button type="submit" variant="outline" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>

        {nav.length > 0 ? (
          <nav aria-label="Section" className="border-t border-border">
            <ul className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-5 py-2">
              {nav.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="block rounded-md px-3 py-2 text-sm whitespace-nowrap text-muted-foreground hover:bg-muted"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </header>

      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-5 py-8">
        {children}
      </main>
    </div>
  );
}
