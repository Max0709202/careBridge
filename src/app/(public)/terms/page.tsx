import type { Metadata } from "next";

import { ContentBody, PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const metadata: Metadata = {
  title: "Terms (MVP placeholder)",
  description: "Placeholder terms of service for the CareBridge MVP. Requires legal review.",
};

export default function TermsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Terms"
        title="Terms of service"
        lead="The intended shape of the agreement between CareBridge and the people who use it."
      />

      <ContentBody>
        <Alert variant="destructive">
          <AlertTitle>Placeholder — not a legal document</AlertTitle>
          <AlertDescription>
            This page records the intended terms so they can be reviewed. It has not been drafted or
            approved by counsel, is not an offer, and must be replaced with reviewed terms before
            launch.
          </AlertDescription>
        </Alert>

        <section aria-labelledby="service">
          <h2 id="service">What the service is</h2>
          <p className="mt-4 text-muted-foreground">
            CareBridge coordinates transportation and optional non-medical companionship for a
            medical appointment that has already been scheduled by someone else. CareBridge does not
            provide medical care, medical advice, diagnosis, treatment, nursing, or emergency
            services, and does not schedule or alter clinical appointments.
          </p>
        </section>

        <section aria-labelledby="accounts">
          <h2 id="accounts">Accounts and authority</h2>
          <p className="mt-4 text-muted-foreground">
            By creating a profile for another adult you confirm that you have that person&apos;s
            permission, or the legal authority, to share their information and to arrange these
            services on their behalf. Consent status is recorded against the profile.
          </p>
        </section>

        <section aria-labelledby="requests">
          <h2 id="requests">Requests and cancellation</h2>
          <p className="mt-4 text-muted-foreground">
            Submitting a request does not by itself guarantee service. A request is arranged only
            once a coordinator confirms it. Families may cancel a request before the visit begins.
            CareBridge may cancel a request it cannot safely staff, and will say so.
          </p>
        </section>

        <section aria-labelledby="companions">
          <h2 id="companions">Companion conduct</h2>
          <p className="mt-4 text-muted-foreground">
            Companions provide non-medical support only. They may not administer medication, perform
            clinical tasks, give medical advice, or make decisions on a client&apos;s behalf.
            Incidents must be reported through the platform.
          </p>
        </section>

        <section aria-labelledby="payment">
          <h2 id="payment">Payment</h2>
          <p className="mt-4 text-muted-foreground">
            Payment is taken through a third-party payment processor. CareBridge does not receive or
            store card details. Pricing, refunds and cancellation fees are not yet defined and
            require review before launch.
          </p>
        </section>

        <section aria-labelledby="liability">
          <h2 id="liability">Limits</h2>
          <p className="mt-4 text-muted-foreground">
            Limitation of liability, dispute resolution, governing law, insurance requirements, and
            the treatment of independent transportation providers are all open items for counsel.
            They are listed here so they are not forgotten, not because they have been decided.
          </p>
        </section>
      </ContentBody>
    </>
  );
}
