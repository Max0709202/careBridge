import { AppShell } from "@/components/layout/app-shell";
import type { NavLink } from "@/lib/site-config";
import { requirePageRole } from "@/server/authz";

// Per-user, auth-gated: never prerender at build time.
export const dynamic = "force-dynamic";

const operationsNav: readonly NavLink[] = [{ href: "/operations/dashboard", label: "Dashboard" }];

export default async function OperationsLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePageRole("OPERATIONS_ADMIN");
  return (
    <AppShell role={ctx.role} email={ctx.email} displayName={ctx.displayName} nav={operationsNav}>
      {children}
    </AppShell>
  );
}
