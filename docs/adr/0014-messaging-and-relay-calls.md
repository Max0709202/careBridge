# ADR-0014 · Messaging with derived membership, and calls through a relay

**Status:** Accepted · **Date:** 2026-10-01

## Context

Dispatchers, families and drivers had no way to reach each other inside the
product. Everything happened by personal phone: a dispatcher rang a family
from a desk line, a driver texted a colleague from their own mobile, and a
family who wanted to say "she'll wait inside" called whichever number they
had. That leaks phone numbers in every direction, leaves no record of what
anybody was told, and gives a dispatcher no way to see which conversation is
about which trip.

The request was for five things:

1. dispatcher ↔ patient chat and calls,
2. dispatcher ↔ driver chat and calls,
3. driver ↔ driver chat,
4. notifications for new messages and incoming calls,
5. conversations tied to the booking or trip they are about.

Two facts about the existing system shaped every answer below. A **patient is
a record, not an account** — the people who sign in are the family members
holding a `PatientAccess` grant. And the family app already promised that calls
would "go through a relay number, so neither side sees the other's real
number", behind a button that said the feature "arrives with the server".

## Decision

### Threads, with membership derived rather than stored

A `Conversation` names its subject — an operator, plus a patient, a driver, a
pair of drivers, or the whole driver team — and optionally the ride it is
about. **It has no participants table.** Who may read a thread is worked out on
every request from the edges the rest of the system already trusts:

| kind | dispatcher | family | driver |
| --- | --- | --- | --- |
| `dispatchFamily` | owner/admin/dispatcher at the operator | active `viewProfile` grant on the patient | — |
| `dispatchDriver` | at the operator | — | that driver, approved; for a ride thread, only while the ride is theirs |
| `driverDriver` | reads, never writes | — | either of the pair, approved, same operator |
| `operatorDrivers` | reads and writes | — | every approved driver at the operator |

The rules live in `domain/conversation-access.ts` and are tested exhaustively;
`ConversationAuthorizer` gathers the facts and decides nothing.

A ride id is still not a capability. Reassigning a ride hands its driver
thread to the new driver and takes it from the old one, with nothing else
changed. A finished ride's thread stays writable by the family and driver for
24 hours, then closes to them; dispatch can always write.

Opening a thread is stricter than reading one. An operator can only open a
line to the family of a patient it has carried, and vice versa — so this does
not become a way for any dispatcher to reach any family on the platform. A
driver can open a thread with a colleague only while that colleague is on
shift.

### Writes over HTTP, fan-out over the socket

The same split as live tracking, for the same reasons: a send needs an answer,
idempotency and audit context live on the request pipeline, and a phone in a
dead zone can post the moment one request gets through. Each message carries a
client-generated id that is also its `Idempotency-Key`, unique per sender, so a
retry after a lost response finds the stored message instead of posting it
twice.

The `/messaging` socket namespace is one-directional and has **no
subscriptions**. Each socket joins its own user's room and nothing else. The
service resolves a thread's members at the moment something happens and
publishes to their rooms, through a Redis pub/sub bus (in-process on a
laptop). Removing someone from a patient's circle simply drops them from the
next list. The socket re-verifies its token every fifteen seconds, as
tracking's does, so a signed-out session stops receiving.

### Notifications: one per thread, routed by app

A message writes `messageReceived` notification rows in its own transaction,
and the existing outbox delivers them — no second delivery path. They are
**merged per conversation**: a recipient who already has an unread one for
that thread does not get another, so a busy thread is one push, not forty.
Bodies are content-free (FOUNDATION §9). Each row carries an `appTarget`, so a
dispatcher's alert goes to the console and a family's to the family app, even
for a person who is both.

Browsers get Web Push (VAPID, RFC 8291/8292) alongside FCM. It is implemented
on `node:crypto` and checked against the RFC's test vector. The encrypted
payload is the same content-free text.

### Calls: a click-to-call bridge through one relay number

The caller presses Call; the provider rings **the caller's own phone** from the
relay number, and when they answer, rings the callee from the same number and
joins the two. Neither side sees the other's number, and it works for anyone
with a telephone — a dispatcher at a desk set, a patient who has never
installed anything.

`CallSession` names the callee by id and **stores no phone number and no
recording**. Numbers are resolved at dial time, so the call log cannot become
a directory. A missed call (the callee's phone rang and nobody answered) raises
`callMissed`; the outcome is written into the thread as a system line ("Call ·
3 min", "Missed call"). Someone ringing the relay number back within a day of a
call is put through to that operator's dispatch line.

The pairs are fixed in `canCall`: dispatch → patient, family member or driver;
family or driver → dispatch; family ↔ driver only while the ride is under way.
Drivers do not ring each other through the relay.

## Alternatives

- **A participants table.** The obvious schema, and the one that would have
  needed a second write every time a grant was revoked, a dispatcher left or a
  ride was reassigned. Each missed write would be a person still reading a
  conversation about somebody's grandmother. Rejected for the same reason
  tracking re-derives `canWatch`.
- **Writes over the socket.** Rejected on every ground tracking rejected it,
  plus one: a message that might or might not have been stored is worse than
  one that visibly failed and offers a retry.
- **In-app VoIP (WebRTC).** Needs TURN servers and CallKit/ConnectionService
  integration, and a browser tab cannot ring when it is closed — so the
  "incoming call" requirement would have been met only on a good day. It also
  cannot reach a patient who has no app, which is most of them.
- **`tel:` links.** Free, and exposes every number to everyone — the opposite
  of the promise the family app already made.
- **A Twilio Proxy session per ride.** Lets either side dial the relay
  directly, but needs a pool of numbers and session bookkeeping; the bridge
  needs one number. Revisit if inbound calling becomes the common case.

## Consequences

- Calling costs money per minute, so `POST /calls` is rate-limited per user and
  the deployment chooses `TELEPHONY_DRIVER` explicitly: `none` is the default,
  `log` simulates locally and is refused in production.
- A caller needs a dialable number of their own (`PUT /calls/my-number`); a
  dispatcher without one rings from the operator's line.
- The driver app still shows the passenger's real number for a `tel:` call
  from the kerb, as it did before. The relay offers a private alternative; it
  does not remove that.
- Messages are kept for a year after a thread's last message, and call
  sessions for a year; empty threads go after a week. Account deletion keeps
  the words and drops the name ("Former member") — ADR-0013's rule, applied.
- The inbox query is a superset filtered by the rules in memory, capped at a
  hundred threads. That is fine at an operator's scale and is the first thing
  to change at a platform's.

## Revisit when

- A dispatch office handles enough threads that the 100-thread inbox cap is
  felt — move the rule into SQL.
- Families ask to call the relay number directly without being rung back
  first — consider per-ride proxy sessions.
- Attachments are requested. They are deliberately absent: a photo of a
  prescription in a chat log is health information with none of the controls
  the documents store has.
