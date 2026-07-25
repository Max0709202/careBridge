import type { Metadata } from "next";

import { ContentBody, PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const metadata: Metadata = {
  title: "Privacy (MVP placeholder)",
  description: "Placeholder privacy notice for the CareBridge MVP. Requires legal review.",
};

export default function PrivacyPage() {
  return (
    <>
      <PageHeader
        eyebrow="Privacy"
        title="Privacy notice"
        lead="A plain description of what we collect and why, written by engineers rather than lawyers."
      />

      <ContentBody>
        <Alert variant="destructive">
          <AlertTitle>Placeholder — not a legal document</AlertTitle>
          <AlertDescription>
            This page describes the MVP&apos;s intended data practices so they can be reviewed. It
            has not been drafted or approved by counsel and must be replaced with a reviewed privacy
            notice before any real user data is collected.
          </AlertDescription>
        </Alert>

        <section aria-labelledby="collect">
          <h2 id="collect">What we collect</h2>
          <ul className="mt-4 space-y-3 text-muted-foreground">
            <li>
              <strong className="text-foreground">Account information</strong> — the email address
              you sign in with, and your role.
            </li>
            <li>
              <strong className="text-foreground">Profile of the person receiving help</strong> —
              preferred name, a legal name only where operationally required, a contact telephone
              number, a pickup address, mobility or accessibility requirements, an emergency
              contact, and any coordination notes you choose to add.
            </li>
            <li>
              <strong className="text-foreground">Requests</strong> — appointment date and local
              time, clinic name and address, and what help is needed.
            </li>
            <li>
              <strong className="text-foreground">Service records</strong> — assignment status,
              check-in and check-out times, and incident reports.
            </li>
            <li>
              <strong className="text-foreground">Payment state</strong> — whether a payment
              succeeded, and identifiers from our payment processor. We never see or store card
              numbers.
            </li>
            <li>
              <strong className="text-foreground">Audit records</strong> — who changed what and
              when, stored as structured metadata rather than copies of the underlying records.
            </li>
          </ul>
        </section>

        <section aria-labelledby="not-collect">
          <h2 id="not-collect">What we deliberately do not collect</h2>
          <p className="mt-4 text-muted-foreground">
            Diagnoses, medical history, medication lists, insurance or claims information, records
            from any electronic health record system, and continuous location or GPS tracking. Full
            date of birth is not collected in the MVP.
          </p>
        </section>

        <section aria-labelledby="use">
          <h2 id="use">How we use it</h2>
          <p className="mt-4 text-muted-foreground">
            To coordinate the service you requested, to show you its status, to keep an audit trail
            of sensitive actions, and to take payment. We do not sell personal information and we do
            not send personal information to analytics tools.
          </p>
        </section>

        <section aria-labelledby="sharing">
          <h2 id="sharing">Who sees what</h2>
          <p className="mt-4 text-muted-foreground">
            Family members see their own family account. Companions see only the assignments given
            to them, without internal coordination notes. Our operations team sees requests in order
            to coordinate them. Service providers — our hosting, database, payment, email and SMS
            vendors — process data on our behalf under their own terms.
          </p>
        </section>

        <section aria-labelledby="retention">
          <h2 id="retention">Retention</h2>
          <p className="mt-4 text-muted-foreground">
            Retention periods are not yet finalised and require legal review. The intended default
            is to keep service records for as long as an account is active, and to keep audit
            records longer than the records they describe. See PRIVACY-DATA-MAP.md in the repository
            for the current working position.
          </p>
        </section>

        <section aria-labelledby="hipaa">
          <h2 id="hipaa">A note on HIPAA</h2>
          <p className="mt-4 text-muted-foreground">
            CareBridge does not claim HIPAA compliance and does not operate as a covered entity or
            business associate. We reduce risk by not collecting clinical information in the first
            place. Whether any part of this service falls within scope of HIPAA or state health
            privacy law is a question for counsel, not for this page.
          </p>
        </section>
      </ContentBody>
    </>
  );
}
