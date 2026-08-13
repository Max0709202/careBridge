# Deployment

Terraform and the production pipeline land in Stage 4. This document is the
target, and the parts already true are marked.

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

## The pipeline (Stage 4)

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

## Alarms (Stage 4)

Error rate, p95 latency, queue depth, failed payments, payment/ledger drift,
map spend, and — specific to this product — **active rides with no position
update inside the staleness threshold**.
