import type { Metadata } from "next";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePageRole } from "@/server/authz";

export const metadata: Metadata = { title: "Operations dashboard" };

export default async function OperationsDashboardPage() {
  const ctx = await requirePageRole("OPERATIONS_ADMIN");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl">Operations</h1>
        <p className="mt-2 text-muted-foreground">
          Signed in as {ctx.email}. The review queue, manual assignment, and audit viewer arrive in
          later development phases.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Coordinator tools</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-muted-foreground">
          <p>This area will bring together:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Requests awaiting review</li>
            <li>Manual caregiver assignment</li>
            <li>Status management and internal notes</li>
            <li>The audit trail</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
