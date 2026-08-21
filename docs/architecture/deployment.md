# Deployment

Built. `infrastructure/terraform/` holds the modules and the two environments;
`.github/workflows/deploy.yml` holds the pipeline. This document is the
reasoning behind them — where something below is a decision rather than a
description, the Terraform says the same thing in a comment beside the
resource.

## Environments

| Environment | Purpose | Deploys |
| ----------- | ------- | ------- |
| Local | `docker compose up` — Postgres, Redis, Mailpit, MinIO, API, web | ✅ today |
| CI | Ephemeral Postgres and Redis service containers | ✅ today |
| Staging | Production-shaped, fictional data only | Automatic, on merge to `main` |
| Production | The pilot | Manual approval |

## The artefact

**One image, built once, promoted.** The container CI built and tested is the
one that reaches production — not a rebuild from the same commit, which is a
different artefact with the same label.

CI builds the API image on every pull request and smoke-tests that it starts
and answers liveness. That is already in place: a build that only happens at
release time fails at release time.

## The pipeline

```
merge to main
  → build and tag image (git sha)
  → push to ECR
  → deploy to staging
      → run migrations            (prisma migrate deploy, as a task)
      → update the ECS service
      → post-deploy health check  (readiness, not liveness)
  → manual approval
  → deploy to production
      → identical steps
      → post-deploy health check
      → 15-minute watch window on error rate and latency
```

### Migrations

Run as a **separate task before the service updates**, never as part of task
startup in production. Two reasons: a rolling update would otherwise run the
migration N times concurrently, and a failed migration should stop the deploy
rather than produce a service whose tasks are crash-looping.

`migrate deploy`, never `migrate dev`. A container start can only apply
migrations that are already committed and reviewed.

**Migrations must be backwards-compatible with the currently running version**,
because for the length of a rolling deploy both versions are live. In practice:
add columns nullable or with defaults; never rename in one step; never drop a
column in the same release that stops writing to it.

CI asserts that the committed migrations apply to a *clean* database and that
`schema.prisma` has no changes without a migration.

## Rollback

**Application:** redeploy the previous image tag. Fast, and safe as long as the
migration rule above was followed.

**Schema:** forward-only. There is no `migrate down`. A bad migration is
corrected by a new migration, because a down-migration written months earlier
and never executed is not a tested recovery path — it is a hope.

The recovery path for a genuinely destructive migration is
[disaster-recovery.md](disaster-recovery.md), and it is rehearsed.

## Configuration

Everything through the validated `AppConfig`. A missing or malformed value
fails the container's **first second**, loudly, naming the variable — rather
than the first request that happens to read it.

Production additionally refuses:

- `CORS_ORIGINS=*`
- the log-only mail and push adapters, and the deterministic geocoder — each
  succeeds while doing nothing, which is the failure mode hardest to notice
- a missing `REDIS_URL` — the in-process scheduler loses every pending job on
  deploy and double-fires with more than one instance

Secrets come from Secrets Manager as task-definition secrets. Never in an
image, a repository, or a client bundle.

## Observability

- **Logs**: structured JSON to CloudWatch, redaction applied at the logger.
- **Health**: `/health/live` for the container, `/health/ready` for the load
  balancer. Liveness checks nothing external, deliberately — a database blip
  must not turn a recoverable outage into a crash loop.
- **Correlation**: one id per request, echoed to the client, on every log line
  and audit row. It is the only thing connecting "it said something went wrong"
  to a stack trace.

## Alarms

In `modules/observability`. Each one is here because somebody would have to be
telephoned about it — an alarm nobody acts on trains people to ignore pages —
so every alarm's description names the next move rather than restating the
metric.

| Alarm | What it means |
| --- | --- |
| Unhealthy tasks | Readiness is failing. Missing data counts as breaching: a balancer reporting nothing is not "fine". |
| 5xx rate | Correlate by correlation id. Missing data does **not** breach — no requests is a quiet night. |
| p95 latency | Usually the database's CPU or the routing vendor's breaker. |
| Database CPU, free storage | Read the slow query log before resizing anything. |
| **Stale tracking** | The one specific to this product: rides in flight with no recent position. A family is watching a map that has stopped. Telephone the dispatcher before looking at anything technical. Threshold is 3 in five minutes, not 1 — a single driver entering a tunnel is ordinary. |
| Payment failures | A spike not spread across accounts is the processor, not the cards. |
| Routing circuit open | Arrival estimates have fallen back to straight-line distance. Degraded, not broken. |

## What Terraform deliberately does not own

The Stripe account, the maps key, the FCM project and the domain registration.
Terraform that creates billing relationships is Terraform that can cancel them;
Terraform that owns a domain can release one. They are bought by a person and
referenced by ARN — see `infrastructure/terraform/bootstrap.md`.

The state backend is the same argument turned inward: a state bucket Terraform
creates is one Terraform can destroy, and recovering means reconstructing the
mapping between every resource and its address by hand.
