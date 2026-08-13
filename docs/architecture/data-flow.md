# Data flow

Four flows, chosen because each one demonstrates a rule the rest of the system
follows.

---

## 1 · An authenticated request

```
Client
  → ALB
  → CorrelationMiddleware      one id per request, into async-local storage
  → RequestLoggerMiddleware    one line per completed request, route pattern only
  → AuthGuard (global)         verifies the JWT *and* its token version
  → ValidationPipe             DTO validation; unknown fields dropped
  → Controller (thin)
  → Service                    explicit policy call, then the work
  → PrismaService
  → ErrorFilter                one envelope, on the way out
```

Two things are load-bearing:

**The guard is global.** Authentication is the default and a route has to *ask*
to be public with `@Public()`. The reverse — remembering `@UseGuards` on each
new controller — is the single most common way an endpoint ships unprotected.

**The token version is checked on every request.** One indexed read, and it is
the price of "sign out everywhere" and "password change" taking effect *now*
rather than in up to fifteen minutes. On a product protecting a vulnerable
person's home address, that is the right trade.

The log line records the **route pattern** (`/api/v1/patients/:id`), never the
concrete URL — a concrete URL puts record ids into log storage and makes every
request its own cardinality bucket in any derived metric.

---

## 2 · A state transition

Appointment cancellation, which touches four things:

```
requireAppointmentPermission          resolves up the graph to PatientAccess
$transaction {
  assertAppointmentTransition         pure domain code; illegal transitions throw
  update appointment + history        append-only status history
  cancel each open ride               a car arriving for a cancelled appointment
                                      is the kind of failure that ends a pilot
  cancel outstanding reminders
  audit.record(tx)                    same transaction — cannot succeed unaudited
}
```

All of it commits or none of it does. The one deliberate leniency: a leg that
has already delivered the passenger is *skipped* rather than allowed to throw,
because otherwise the family loses the ability to cancel the appointment at all
for the minutes between arrival and completion — precisely when they are most
likely to try.

---

## 3 · A notification

```
transaction commits            ← the Notification row is written here
        │
        ▼
outbox sweep (every 5s)        finds notifications with no delivery rows
        │
        ▼
queue: notifications           jobId derived from the notification id
        │
        ▼
NotificationDispatchService
        ├── inApp     already delivered; recorded as sent
        ├── email     if the user's preferences allow it
        └── push      to family-app device tokens only
        │
        ▼
NotificationDelivery rows      sent | failed | suppressed, per channel
```

**Why a sweep rather than a call at each of the seven places that create
notifications.** Enqueuing *inside* the transaction produces jobs for rows a
rollback then removes. Enqueuing *after* it means every current and future call
site has to remember to, and one that forgets produces a notification the app
shows and nobody outside it ever hears about. A sweep cannot be forgotten.

Several instances sweeping find the same row; the job id is derived from the
notification id, so BullMQ collapses the duplicates.

The consequence — which is the right one — is that **the timeline is never
wrong even when delivery is.** A notification whose email bounced is a delivery
problem. A ride that silently failed to complete because a push token was stale
would be a correctness problem.

---

## 4 · A reminder

```
appointment created / rescheduled
        │
        ▼  (inside the transaction)
scheduleReminders()            pure: local wall time in the clinic's IANA zone
        │                      whole days walk the calendar; the remainder is exact
        ▼
appointment_reminders rows     the record of intent
        │
        ▼  (after commit)
enqueuePending()               sets the timers; jobId derived from the row id
        │
        ▼  at the scheduled instant
fire()                         re-reads the row — the appointment may have been
                               cancelled, and a timer has no way to know
        │
        ▼
notifyPatientCircle()          contentless, to everyone with viewProfile
```

At boot, `rehydrate()` re-arms every pending row. That is what makes losing
Redis survivable, and it is why the database — not the queue — is the record of
intent.

---

## Live tracking (Stage 3)

Described in [realtime-tracking.md](realtime-tracking.md). The summary: points
go over an authenticated Socket.IO connection, every inbound point re-verifies
that the sender is the driver *currently assigned* and that the ride is in a
state where tracking is legal, the latest position lands in Redis with a short
TTL, a sampled subset persists to Postgres for 30 days, and subscribers receive
`capturedAt` so every client can render freshness rather than a confident lie.
