import type { Metadata } from "next";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePageRole } from "@/server/authz";

export const metadata: Metadata = { title: "Caregiver dashboard" };

export default async function CaregiverDashboardPage() {
  const ctx = await requirePageRole("CAREGIVER");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl">Welcome{ctx.displayName ? `, ${ctx.displayName}` : ""}</h1>
        <p className="mt-2 text-muted-foreground">
          Assignments, availability, and check-in arrive in the next development phase.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Your account</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground">
          <p>
            You only ever see the visits assigned to you. Internal coordination notes are never
            shown to caregivers.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
