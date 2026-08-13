# User journeys

Six flows the product must support end to end. Each names the acceptance
condition that decides whether it is done.

---

## 1 · Getting set up

Ada registers → confirms her email → creates a patient record for Margaret →
records mobility needs (walker, escort to door) and an emergency contact →
invites her brother into the care circle.

**The hard part:** the invitation. It grants standing access to a vulnerable
person's home address and daily movements, so it is single-use, expiring, and
bound to the invited email address — which must itself be verified. See
[../architecture/security-model.md](../architecture/security-model.md).

**Done when:** the brother sees Margaret in his app, with exactly the
permissions Ada chose, and a revoked grant disappears from his next request.

---

## 2 · Recording an appointment

Ada adds the cardiology follow-up: clinic, Thursday 10:40, expected 45 minutes.

**The hard part:** the appointment is **recorded**, not booked into a clinic
system (P2). There is no EHR integration in the MVP, and the product must not
imply there is.

**Also:** the appointment inherits the *clinic's* IANA time zone, because that
is where it happens. Reminder offsets are measured against local wall time, so
"the day before at 10:40" survives a daylight-saving boundary.

**Done when:** the appointment appears for everyone in the circle, and its
reminders exist as database rows with resolved UTC instants.

---

## 3 · Requesting transport

Ada requests a round trip against the appointment. She sees a price estimate
before confirming.

**The hard part:** a round trip is **two rides sharing a group id**, not one
ride with two legs — each is assigned, tracked, cancelled and priced
independently. The return leg is often *flexible*: nobody knows when the
appointment will end (P4).

**Done when:** two rides exist, the estimate is itemised against a versioned
pricing rule, and cancelling the appointment cancels both.

---

## 4 · Assignment

Dispatch assigns a driver and vehicle. Ada is notified, and can see the
driver's first name, photo and vehicle.

**The hard part:** a wheelchair requirement is a **hard constraint** on
assignment, never a preference (P7). Payment is authorised at this point, not
at completion.

**Done when:** an unapproved driver cannot be assigned, an inaccessible vehicle
cannot be assigned to a wheelchair ride, and reassignment appends history
rather than overwriting it.

---

## 5 · The journey

The driver moves through: en route → arrived → passenger onboard → in progress
→ arrived at destination → completed. Ada watches a live map and gets a
notification per transition.

**The hard part:** this is the whole product. Every transition is
server-validated; every location write re-verifies that the sender is the
driver *currently assigned* to that ride and that the ride is in a state where
tracking is legal. A ride id is not a capability.

**Done when:** location writes stop within seconds of completion and are
rejected thereafter; a stale position is visibly marked in every client; a
driver killing the app mid-ride does not corrupt ride state.

---

## 6 · Afterwards

The fare is captured. A receipt is available. Everything lands in a timeline
Ada can read back later.

**The hard part:** the timeline is the dispute-resolution record and the audit
trail at the same time. It must be complete even when delivery of the
notifications about it failed.

**Done when:** the timeline reconstructs the journey from the event log alone,
and a duplicate payment webhook produces exactly one ledger entry.

---

## The journey nobody designs for

Margaret's phone is in her bag and she does not hear it. Ada is in a meeting.
The driver is nine minutes late because of an accident on the bridge.

Every one of the six journeys above has to still be readable when this is what
is happening — which is why delay is a **flag** on a ride rather than a status,
so it can be raised and cleared without losing the state the ride must return
to.
