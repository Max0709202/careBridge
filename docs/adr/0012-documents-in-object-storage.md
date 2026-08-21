# ADR-0012 · Driver documents in object storage, behind pre-signed URLs

**Status:** Accepted · **Date:** 2026-08-21

## Context

A driver may not carry a passenger until an operator has seen a licence, proof
of insurance and a vehicle registration. Those files have to be collected,
reviewed, kept for as long as the rides they covered are disputable, and shown
to a small number of named people.

They are also the most sensitive objects in this system. A licence scan carries
a **home address, a date of birth and a photograph** — the three things
CareBridge otherwise refuses to store anywhere (FOUNDATION §6: no date of birth
in the schema, `ageBand` is coarse by design). The database has no column that
could hold one and should not acquire one.

## Decision

Files live in **object storage**, behind a `StoragePort`. The database holds a
key, a content type, a size, a checksum and the decision made about the file.

**The bytes never pass through the API.** A client is given a pre-signed URL
that permits exactly one PUT, of one content type, up to one size, for ten
minutes. A reviewer is given a URL that permits one GET for two minutes.

Two adapters:

- `S3StorageAdapter` — S3 in production, and MinIO in the local stack via
  `forcePathStyle`. The same adapter, so what a developer runs against is the
  code production runs.
- `FilesystemStorageAdapter` — a directory on disk, with the pre-signed-URL
  dance played out against this API's own `/storage/local/:token` routes.

## Why the bytes stay out of the process

- **Memory.** A multipart body through Node is a copy of a photograph in the
  heap of an API that is also holding a WebSocket open for every live ride.
- **Blast radius.** An API that can stream any object is an API where one
  path-traversal bug hands over the whole bucket. One that only mints a URL for
  one key, after an authorisation check, cannot.
- **Cost and latency.** A 5 MB scan does not need to make two trips.

## Why the local adapter is not "a fake"

It reproduces the *shape*: authorise, upload out of band, confirm against
storage, download through a link that expires. A local adapter that let the API
accept a multipart body would have developers exercising a code path the
deployed system does not have, which is how "it worked locally" gets said out
loud. Its tokens are 24 random bytes, name one object and one method, expire in
minutes, and a PUT token is spent on first use — which is what an S3 pre-signed
URL is.

## Alternatives

**Bytes through the API, streamed to storage.** One less round trip for the
client and a much larger surface for us: request size limits, multipart
parsing, back-pressure, and an endpoint that by construction can read any key.
Rejected.

**Files in Postgres as `bytea`.** Backups become enormous, the connection pool
carries megabytes, and a `SELECT *` written by somebody in a hurry pulls a
photograph into a log. Rejected.

**A signed URL from a CDN.** The right answer at a scale this product is not
at, and it adds a second place where an expiry can be configured wrongly.

## Consequences

- Production **refuses** the filesystem adapter at boot, like every other local
  adapter. A certificate on a container's ephemeral disk vanishes at the next
  deploy.
- **The API confirms uploads against storage** rather than trusting the client
  to report them. A client that says "done" could say it without uploading, and
  an operator would then see a complete file with an empty object behind it.
- **Every view is audited**, with the actor. "Who has seen this driver's
  licence" is a question an investigation asks and cannot be answered
  retroactively.
- **Object keys carry no readable identifier** — no name, no licence number. A
  bucket listing must not be a roster.
- **Downloads are served `attachment` with `nosniff`.** This serves whatever a
  driver uploaded, and a file that renders in a browser is a file that can
  carry script on the API's own origin.
- Renewals **supersede** rather than overwrite. "Which certificate was in force
  in March" stays answerable, which is the whole reason to keep documents once
  a dispute starts.
- Approving a driver is gated on compliance **inside the transaction**. The
  console greys the button out, but a check only a screen performs is one a
  second tab can race past — and what it guards is whether somebody carries a
  passenger uninsured.
- The required set deliberately **excludes the background check**. A platform
  lookup is of variable quality and coverage; treating it as the thing that
  makes somebody safe would be a claim this product does not make. The operator
  decides who to employ; the system enforces the legal minimum.

## Revisit when

- A document type is needed that is not one of the four collected. The list is
  short on purpose.
- Retention law for the pilot state requires something other than "as long as
  the rides it covered are disputable".
- Object storage spend becomes visible against the per-ride cost ceiling.
