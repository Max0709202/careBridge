import { AppShell } from "@/components/layout/app-shell";
import type { NavLink } from "@/lib/site-config";
import { requirePageRole } from "@/server/authz";

// Per-user, auth-gated: never prerender at build time.
export const dynamic = "force-dynamic";

const caregiverNav: readonly NavLink[] = [{ href: "/caregiver/dashboard", label: "Dashboard" }];

export default async function CaregiverLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePageRole("CAREGIVER");
  return (
    <AppShell role={ctx.role} email={ctx.email} displayName={ctx.displayName} nav={caregiverNav}>
      {children}
    </AppShell>
  );
}
