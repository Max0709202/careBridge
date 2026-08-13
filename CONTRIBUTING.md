# Contributing

## Getting a working environment

The Dart half is a **pub workspace**: the root `pubspec.yaml` declares
`workspace:` and carries the melos config, and melos is a dev dependency rather
than a global binary — so `dart run melos` is the only correct invocation and
everyone runs the version in the lockfile.

One wrinkle worth knowing: a pub workspace root is never a member of its own
workspace, and this root *is* the family app. So melos covers
`packages/dart/*` and the Makefile drives the app directly with `flutter`.
Relocating the app to `apps/mobile_family/` (FOUNDATION §8) would collapse that
into one mechanism, and is worth doing on its own rather than folded into a
feature change.

```bash
cp .env.example .env
# replace JWT_SECRET with a real one:
openssl rand -base64 48

make install     # pnpm workspace + melos bootstrap
make up          # Postgres, Redis, Mailpit, MinIO
make migrate
make seed
make api         # http://localhost:3000/api/v1
```

`http://localhost:8025` is Mailpit: every email the API sends is caught there,
including the verification, reset and invitation links.

### Without Docker

The API runs against a local Postgres with no Redis, no mail server and no
maps key. It says so at boot, and it is honest about what that costs — the
in-process scheduler loses pending jobs on restart. See
[docs/adr/0008-redis-bullmq.md](docs/adr/0008-redis-bullmq.md).

Production refuses those adapters, so this cannot leak into a deployment.

### Run the integration suite both ways

```bash
make test-integration                                    # in-process scheduler
REDIS_URL=redis://127.0.0.1:56379 make test-integration   # the real BullMQ path
```

The suite is green either way. That is deliberate: it asserts on the *rows* —
a reminder exists, it is re-armed at boot, it fires once — and those are true
whichever scheduler sits behind the port. Running it both ways is the only
thing that actually proves the two adapters are interchangeable rather than
merely similar. One test asserts which driver is live, so a run cannot silently
fall back and be mistaken for a passing test of the BullMQ path.

## Before you push

```bash
make check     # format, lint, typecheck, test, contract drift
```

That is exactly what CI runs, in CI's order. **If the two diverge, CI is what
is wrong** — a check that cannot be reproduced on a laptop is a check people
learn to re-run rather than fix.

## The rules that are enforced rather than requested

| Rule | Enforced by |
| ---- | ----------- |
| No `console` | ESLint. It bypasses the pino redaction denylist, and one `console.log(user)` puts a name, an email and a phone number into CloudWatch |
| No direct `process.env` | ESLint. Exactly one file may read it |
| No cross-module deep imports | ESLint boundary rules |
| No Nest or Prisma in `src/domain/` | ESLint. That purity is what makes the state machines exhaustively testable |
| The OpenAPI document and Dart client are current | `make contract-drift`, in CI |
| Migrations apply to a clean database | CI |
| No "HIPAA compliant" claim | CI |

## Writing a new endpoint

1. **DTO first**, with `class-validator` *and* `@ApiProperty`. The decorators
   are the contract: the OpenAPI document and the Dart client are generated
   from them.
2. **Thin controller.** Route, guard metadata, DTO, delegate.
3. **The policy call is explicit** in the service, even though the guard ran.
   The guard proves *who*; the service proves *may they, for this record*.
4. **Audit inside the transaction**, passing `tx`. An audited action must not
   be able to succeed unaudited.
5. **Negative tests are a merge requirement**, not a nice-to-have. Use the
   helper set in `apps/api/test/support/negative-paths.ts`:
   `expectsAuthentication`, `expectsIndistinguishableDenial`,
   `expectsRevocationTakesEffect`, `expectsPermissionScope`.
6. `make dart-client` and commit the regenerated output.

## Writing tests

**Unit** (`src/**/*.spec.ts`) — pure, parallel, milliseconds. Domain rules,
state machines, pure functions. The reminder scheduler's DST behaviour is a
unit test with an injected clock, because waiting for October is not a strategy.

**Integration** (`test/*.e2e-spec.ts`) — the real application against a real
Postgres. Build the fixtures **through the API**, not with direct row writes: a
fixture that cannot be created through the API describes a state the system
cannot reach, and a test written against it proves nothing.

The one deliberate exception is `verifyEmail`, which reaches into the token
table because parsing an email in every setup block would make each test's
intent harder to read than the thing it tests. The link itself *is* tested end
to end, once, in `auth.e2e-spec.ts`.

## Comments

Write the **why**, not the what. The bar: would a competent engineer reading
this in six months wonder why it is this way? If yes, that is a comment. If the
code already says it, it is noise.

The comments that have earned their place in this codebase are the ones that
record a *rejected alternative* — why the reminder scheduler splits days from
minutes, why the notification outbox is a sweep rather than a call, why
`AuthorizationError` and `NotFoundError` are indistinguishable.

## Commits

Present tense, describing the change. If the change encodes a decision with a
real alternative, that belongs in an ADR, not only in a commit message.
