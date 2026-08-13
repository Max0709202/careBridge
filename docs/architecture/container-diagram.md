# Containers and processes

What actually runs, in each environment, and what it is allowed to talk to.

## Local development

`docker compose up` brings up five containers.

| Container | Image | Port (host) | Purpose |
| --------- | ----- | ----------- | ------- |
| `db` | `postgres:16-alpine` | 127.0.0.1:55432 | The same major version as RDS |
| `redis` | `redis:7-alpine` | 127.0.0.1:56379 | Queues; live location from Stage 3 |
| `mailpit` | `axllent/mailpit` | 127.0.0.1:1025 (SMTP), :8025 (UI) | Catches every email the API sends |
| `minio` | `minio/minio` | 127.0.0.1:9000, :9001 | S3-compatible object storage |
| `api` | built from `apps/api/Dockerfile` | 127.0.0.1:3000 | The application |
| `web` | built from `Dockerfile.web` | 8080 | The family app, Flutter Web, behind nginx |

Every port except the web one is bound to **loopback**. A database on `0.0.0.0`
is one misconfigured firewall away from being everybody's database.

nginx proxies `/api` to the API container, so every browser request is
same-origin and CORS never enters the picture. The `CORS_ORIGINS` allowlist
exists for `flutter run` against the host.

### The API image

Multi-stage. The builder resolves the pnpm workspace, generates the Prisma
client and compiles; `pnpm deploy --prod` then materialises a self-contained
tree with the workspace links resolved, so the runner stage never needs to know
a workspace existed.

The runner carries compiled output and production dependencies only — no
TypeScript sources, no test tooling, no compiler. It runs as `node`, never
root, and its `HEALTHCHECK` hits **liveness**, not readiness: a database blip
must not get the container killed and restarted, which would turn a recoverable
outage into a crash loop.

Migrations run in the entrypoint, before the process accepts traffic, with
`migrate deploy` — never `migrate dev`, so a container start can only apply
migrations that are already committed.

## Production (Stage 4)

```
Route 53 → ACM → ALB (WAF) → ECS Fargate service (N tasks)
                                   ├── RDS PostgreSQL (Multi-AZ)
                                   ├── ElastiCache Redis
                                   ├── S3 (documents, receipts)
                                   └── Secrets Manager
```

| Concern | Where |
| ------- | ----- |
| TLS termination | ALB, TLS 1.2+, HSTS, no plaintext listener |
| Secrets | Secrets Manager, injected as task-definition secrets — never in an image, a repository, or a client bundle |
| Logs | CloudWatch, structured JSON from pino, with the redaction denylist already applied at the logger |
| Images | ECR, the same artefact CI built and tested |

### Process topology

One process type today: the API, which also hosts the BullMQ workers and (from
Stage 3) the Socket.IO gateway.

That is a deliberate simplification for pilot scale (T3), and the seam to split
it is already in place: workers are registered through the `QueuePort`, so a
worker-only process is a different bootstrap rather than a refactor. The signal
to split is queue depth affecting request latency — not a schedule.

### What can talk to what

- The clients reach **only** the ALB.
- The ECS tasks reach RDS, ElastiCache, S3, Secrets Manager and the four
  external vendors. Nothing reaches *them* except the ALB.
- RDS and ElastiCache are in private subnets with no route to the internet.
- S3 objects are private with no public ACL path, reachable only through
  short-lived pre-signed URLs issued after an authorisation check.
