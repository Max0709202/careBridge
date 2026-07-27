import type { Metadata } from "next";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePageRole } from "@/server/authz";

export const metadata: Metadata = { title: "Family dashboard" };

export default async function FamilyDashboardPage() {
  const ctx = await requirePageRole("FAMILY");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl">Welcome{ctx.displayName ? `, ${ctx.displayName}` : ""}</h1>
        <p className="mt-2 text-muted-foreground">
          This is your family dashboard. Adding a senior profile and creating a request arrive in
          the next development phase.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Getting set up</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-muted-foreground">
          <p>Soon you will be able to:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Add the family member you are helping</li>
            <li>Create a request for an appointment they already have</li>
            <li>Follow each request as a coordinator arranges it</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
