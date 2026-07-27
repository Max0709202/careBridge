import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { ContentBody, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "How CareBridge coordinates transportation and an optional companion for an appointment you have already scheduled.",
};

const familySteps = [
  {
    title: "Create a family account",
    body: "One account per family. You can invite a sibling or another relative to share the same view, so nobody is left guessing.",
  },
  {
    title: "Add the person you are helping",
    body: "A short profile: what they like to be called, how to reach them, where to pick them up, any mobility or accessibility needs, and an emergency contact. We ask for as little as we can.",
  },
  {
    title: "Send us the appointment",
    body: "Date, local time, clinic name and address, whether a ride is needed, whether the vehicle needs to be wheelchair accessible, and whether you would like a companion along.",
  },
  {
    title: "A coordinator reviews it",
    body: "Your request moves to Submitted, then Under review while a coordinator confirms the details and arranges the ride. You will see each change.",
  },
  {
    title: "Confirmation and updates",
    body: "Once arrangements are set the request is Confirmed. If you asked for a companion, you will see when one has been assigned, when they check in, and when the visit is complete.",
  },
];

export default function HowItWorksPage() {
  return (
    <>
      <PageHeader
        eyebrow="How it works"
        title="One request, handled by a person"
        lead="CareBridge is a managed service, not a marketplace. Nothing is auto-matched and nothing is dispatched without a coordinator looking at it first."
      />

      <div className="mx-auto max-w-3xl px-5 pt-12">
        <div className="relative aspect-[16/9] w-full overflow-hidden rounded-2xl ring-1 ring-foreground/10">
          <Image
            src="/media/transport.jpg"
            alt="A driver at the wheel on a city street at dusk."
            fill
            sizes="(min-width: 768px) 48rem, 100vw"
            className="object-cover"
          />
        </div>
      </div>

      <ContentBody>
        <section aria-labelledby="family-steps">
          <h2 id="family-steps">For families</h2>
          <ol className="mt-6 space-y-6">
            {familySteps.map((step, index) => (
              <li key={step.title} className="flex gap-5">
                <span
                  aria-hidden
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary font-semibold text-secondary-foreground"
                >
                  {index + 1}
                </span>
                <div>
                  <h3 className="font-semibold">{step.title}</h3>
                  <p className="mt-2 text-muted-foreground">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="statuses">
          <h2 id="statuses">What the statuses mean</h2>
          <dl className="mt-6 space-y-4">
            {[
              ["Draft", "Not sent yet. You can still change anything."],
              ["Submitted", "We have it. A coordinator will pick it up."],
              ["Under review", "A coordinator is arranging the details."],
              ["Confirmed", "Arrangements are set for the scheduled date."],
              ["Companion assigned", "A companion has accepted this visit."],
              ["In progress", "The visit is under way."],
              ["Completed", "The visit is finished."],
              ["Cancelled", "The request was cancelled. You will always see who cancelled it."],
            ].map(([term, definition]) => (
              <div key={term} className="border-l-2 border-border pl-4">
                <dt className="font-semibold">{term}</dt>
                <dd className="mt-1 text-muted-foreground">{definition}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="companions">
          <h2 id="companions">About companions</h2>
          <p className="mt-4 text-muted-foreground">
            A companion is a non-medical support person. They can meet your family member, travel
            with them, help them find the right desk, and stay until the visit is over. They do not
            provide medical care, do not give medical advice, and do not make decisions on
            anyone&apos;s behalf.
          </p>
          <p className="mt-4 text-muted-foreground">
            Companions are assigned by our operations team, never automatically. A companion only
            sees the visit they have been assigned to.
          </p>
        </section>

        <section aria-labelledby="next">
          <h2 id="next">Ready to start?</h2>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/sign-up">Create an account</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/safety">Read about safety</Link>
            </Button>
          </div>
        </section>
      </ContentBody>
    </>
  );
}
