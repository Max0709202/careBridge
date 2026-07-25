import type { Metadata } from "next";

import { ContentBody, PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const metadata: Metadata = {
  title: "Safety",
  description:
    "How CareBridge limits access to information, what companions can and cannot do, and what to do in an emergency.",
};

export default function SafetyPage() {
  return (
    <>
      <PageHeader
        eyebrow="Safety"
        title="How we try to keep this safe"
        lead="Coordinating care for an older adult means holding information about a person who may be vulnerable. Here is how we handle that, and where our limits are."
      />

      <ContentBody>
        <Alert>
          <AlertTitle>In an emergency, call 911</AlertTitle>
          <AlertDescription>
            CareBridge is not an emergency service and is not monitored around the clock. Do not use
            it to report a medical emergency.
          </AlertDescription>
        </Alert>

        <section aria-labelledby="scope">
          <h2 id="scope">We stay out of medical decisions</h2>
          <p className="mt-4 text-muted-foreground">
            CareBridge coordinates logistics: a ride, and optionally a non-medical companion, for an
            appointment that already exists. We do not give medical advice, suggest treatments,
            manage medications, or contact clinicians on your behalf. If a question is medical, it
            belongs with your family member&apos;s clinician.
          </p>
        </section>

        <section aria-labelledby="access">
          <h2 id="access">Access is limited by role</h2>
          <ul className="mt-4 space-y-3 text-muted-foreground">
            <li>
              <strong className="text-foreground">Family members</strong> see only the people and
              requests belonging to their own family account.
            </li>
            <li>
              <strong className="text-foreground">Companions</strong> see only the visits they have
              been assigned to, and only the details needed to carry them out. They never see
              internal coordination notes.
            </li>
            <li>
              <strong className="text-foreground">Our operations team</strong> sees requests in
              order to coordinate them. Sensitive actions are recorded in an audit log.
            </li>
          </ul>
          <p className="mt-4 text-muted-foreground">
            These limits are enforced on our servers and in the database itself, not by hiding
            buttons in the interface.
          </p>
        </section>

        <section aria-labelledby="minimisation">
          <h2 id="minimisation">We ask for less</h2>
          <p className="mt-4 text-muted-foreground">
            We deliberately do not collect medical history, diagnoses, medication lists, or
            insurance details. For mobility we ask what a driver actually needs to know — for
            example whether a wheelchair-accessible vehicle is required — not why.
          </p>
        </section>

        <section aria-labelledby="notifications">
          <h2 id="notifications">Notifications stay vague on purpose</h2>
          <p className="mt-4 text-muted-foreground">
            Text messages and emails from CareBridge tell you that something changed and ask you to
            sign in. They do not include appointment details, clinic names, or addresses, because a
            phone on a kitchen table is not a private place.
          </p>
        </section>

        <section aria-labelledby="reporting">
          <h2 id="reporting">Reporting a problem</h2>
          <p className="mt-4 text-muted-foreground">
            Companions can file an incident report from their assignment. Our operations team
            reviews unresolved incidents as a standing item. Families can cancel a request up until
            the visit begins, and can contact the coordination team at any point.
          </p>
        </section>

        <section aria-labelledby="limits">
          <h2 id="limits">What we are not claiming</h2>
          <p className="mt-4 text-muted-foreground">
            This is a pre-release MVP. CareBridge does not operate as a HIPAA covered entity or
            business associate, and we make no claim of HIPAA compliance. We are not a licensed
            home-care agency, a medical transport provider, or a healthcare provider of any kind.
          </p>
        </section>
      </ContentBody>
    </>
  );
}
