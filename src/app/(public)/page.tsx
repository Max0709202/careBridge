import Link from "next/link";
import { CalendarCheck, CarFront, ClipboardList, HeartHandshake, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const steps = [
  {
    icon: ClipboardList,
    title: "Tell us about the appointment",
    body: "You already have the appointment booked. Share the date, time, clinic, and what kind of help is needed.",
  },
  {
    icon: CalendarCheck,
    title: "A coordinator reviews it",
    body: "A real person on our operations team checks the details and arranges the pieces. No automated matching.",
  },
  {
    icon: CarFront,
    title: "Transportation is arranged",
    body: "Ride details are confirmed and entered by the coordinator, then shared with you.",
  },
  {
    icon: HeartHandshake,
    title: "A companion joins, if you asked",
    body: "An optional non-medical companion can accompany your family member to and from the visit.",
  },
];

const included = [
  "Coordinating a ride to and from an appointment you have already scheduled",
  "Arranging wheelchair-accessible transportation when it is needed",
  "An optional non-medical companion for the visit",
  "Status updates as arrangements are confirmed",
  "One place for the details, so siblings are not texting each other at midnight",
];

const notIncluded = [
  "Medical care, medical advice, or clinical decisions",
  "Managing medications or treatment",
  "Emergency or ambulance services",
  "Booking or changing appointments with a clinic",
  "Insurance claims or billing with providers",
];

export default function HomePage() {
  return (
    <>
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold tracking-wide text-primary uppercase">
              Coordinated by real people
            </p>
            <h1 className="mt-4 text-4xl sm:text-5xl">
              Getting your parent to the doctor, without the scramble.
            </h1>
            <p className="mt-6 text-lg text-muted-foreground">
              CareBridge arranges transportation and an optional companion for an appointment your
              family member already has. You send the details once. A coordinator handles the rest
              and keeps you posted.
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/sign-up">Create an account</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/how-it-works">See how it works</Link>
              </Button>
            </div>

            <p className="mt-6 text-sm text-muted-foreground">
              CareBridge is not a medical service and does not provide medical advice. In an
              emergency, call 911.
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="steps-heading" className="mx-auto max-w-6xl px-5 py-16 sm:py-20">
        <h2 id="steps-heading" className="text-3xl">
          How a request works
        </h2>
        <p className="mt-3 max-w-2xl text-lg text-muted-foreground">
          Four steps, each one handled by a person you can reach.
        </p>

        <ol className="mt-10 grid gap-6 sm:grid-cols-2">
          {steps.map((step, index) => (
            <li key={step.title}>
              <Card className="h-full">
                <CardHeader>
                  <div className="flex items-start gap-4">
                    <span
                      aria-hidden
                      className="flex size-11 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground"
                    >
                      <step.icon className="size-5" />
                    </span>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Step {index + 1}</p>
                      <CardTitle className="mt-1 text-xl">{step.title}</CardTitle>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground">{step.body}</p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <section
        aria-labelledby="scope-heading"
        className="border-y border-border bg-muted/40 py-16 sm:py-20"
      >
        <div className="mx-auto max-w-6xl px-5">
          <h2 id="scope-heading" className="text-3xl">
            What CareBridge does — and does not do
          </h2>
          <p className="mt-3 max-w-2xl text-lg text-muted-foreground">
            Being specific about the boundary is part of doing this responsibly.
          </p>

          <div className="mt-10 grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-xl">What we coordinate</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {included.map((item) => (
                    <li key={item} className="flex gap-3">
                      <span aria-hidden className="mt-1 shrink-0 text-primary">
                        ✓
                      </span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-xl">What we do not do</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {notIncluded.map((item) => (
                    <li key={item} className="flex gap-3">
                      <span aria-hidden className="mt-1 shrink-0 text-muted-foreground">
                        —
                      </span>
                      <span className="text-muted-foreground">{item}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <section aria-labelledby="trust-heading" className="mx-auto max-w-6xl px-5 py-16 sm:py-20">
        <div className="grid items-start gap-10 md:grid-cols-[auto_1fr]">
          <span
            aria-hidden
            className="hidden size-14 items-center justify-center rounded-full bg-secondary text-secondary-foreground md:flex"
          >
            <ShieldCheck className="size-7" />
          </span>
          <div className="max-w-2xl">
            <h2 id="trust-heading" className="text-3xl">
              We ask for as little as possible
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              We collect only what a coordinator needs to arrange a ride and a companion — not a
              medical history. Access is limited by role: a companion sees the visit they are
              assigned to and nothing else.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Button asChild variant="outline">
                <Link href="/safety">Read about safety</Link>
              </Button>
              <Button asChild variant="ghost">
                <Link href="/privacy">Privacy approach</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto max-w-6xl px-5 py-16 text-center sm:py-20">
          <h2 className="text-3xl">Ready to set up a request?</h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-muted-foreground">
            Create a family account, add the person you are helping, and send us the appointment.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/sign-up">Create an account</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/sign-in">I already have one</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
