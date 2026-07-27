import { AppShell } from "@/components/layout/app-shell";
import type { NavLink } from "@/lib/site-config";
import { requirePageRole } from "@/server/authz";

// Per-user, auth-gated: never prerender at build time.
export const dynamic = "force-dynamic";

const familyNav: readonly NavLink[] = [{ href: "/family/dashboard", label: "Dashboard" }];

export default async function FamilyLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePageRole("FAMILY");
  return (
    <AppShell role={ctx.role} email={ctx.email} displayName={ctx.displayName} nav={familyNav}>
      {children}
    </AppShell>
  );
}
