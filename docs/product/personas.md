# Personas

Four users are served in the MVP. The family member is the **payer**, the
patient is the **beneficiary**, and the driver is the **data source**. All
three must be served or the loop does not close — this split is the single most
important structural fact about the product.

---

## Ada — the family member

**45–65, working, often two states away, coordinating for a parent.** The buyer
and the daily active user.

**Needs:** certainty; fewer phone calls; proof of what happened.

**Context of use:** between meetings, on a phone, with thirty seconds of
attention. Opens the app to answer one question and expects it answered above
the fold.

**What loses her:** a map that looks confident and is wrong; a notification
that says nothing and links nowhere; being told to call dispatch.

**Where:** the family app.

---

## Margaret — the patient

**70+.** May have low vision, a tremor, hearing loss, or mild cognitive
impairment.

**Needs:** to know who is coming, when, and in what car. Nothing else.

**Context of use:** at home, unhurried, possibly on a device she did not
choose. Frequently **will not install an app at all** (P3) — the family app must
work fully with her never touching it.

**Design consequences:** 44px minimum touch targets, 17px base type, AA
contrast, dynamic type support, and a simplified mode that is a mode within the
family app rather than a third binary (P6).

**What loses her:** density; jargon; anything that requires remembering a
previous screen.

---

## Tunde — the driver

**Contract or employed NEMT driver.** Phone mounted, gloves on, running late.

**Needs:** the next task, one tap, no reading.

**Context of use:** in a vehicle, in motion or about to be, in sunlight, with
intermittent connectivity (T1).

**Design consequences:** the state-transition button is the largest thing on
the screen; every transition queues offline and reconciles on reconnect;
background location is a foreground service with a persistent notification, so
the driver can always see that it is on (T2).

**What loses him:** battery drain; a transition that fails silently in a dead
zone; being asked to type.

**Where:** the driver app — a separate install, so its background-location
entitlement never appears on the family app (D4).

---

## Priya — the dispatcher

**Operations staff at a transport provider.** 40–200 rides a day.

**Needs:** density; exceptions surfaced; fast reassignment.

**Context of use:** a desk, a large screen, a keyboard, all day. This is the
one surface where information density beats simplicity.

**Design consequences:** this is why the ops console exists as a Flutter Web
target rather than a phone screen — a dense, multi-pane, keyboard-driven
surface is the worst possible fit for a phone. Tracked as risk R1 until it
lands.

**What loses her:** having to scroll; having to refresh; a queue that does not
tell her which ride is about to become a problem.

**Where:** `ops_console`.

---

## Post-MVP

**Clinic front desk** cares about arrival times and no-shows — served in Stage
5B. **Caregivers** are a Stage 5A marketplace. **Administrators** (us) share
the ops console.
