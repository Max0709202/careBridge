# Architecture decision records

One file per decision that had a real alternative. Each records what we chose,
what we rejected, and — most importantly — **what would make us revisit it**.

An ADR without a revisit trigger is a decision nobody can ever reopen without
seeming to relitigate it.

| # | Decision | Status |
| - | -------- | ------ |
| [0001](0001-modular-monolith.md) | A modular monolith, not microservices | Accepted |
| [0002](0002-riverpod-state-management.md) | Riverpod, not Bloc | Accepted |
| [0003](0003-application-managed-auth.md) | Application-managed auth, not Cognito or Auth0 | Accepted |
| [0004](0004-maps-vendor-behind-interface.md) | One maps vendor, behind an interface | Accepted |
| [0005](0005-foreground-location.md) | Foreground-service location first | Accepted |
| [0006](0006-stripe-payments.md) | Stripe, with card data never touching us | Accepted |
| [0007](0007-postgresql-prisma.md) | PostgreSQL with Prisma | Accepted |
| [0008](0008-redis-bullmq.md) | Redis and BullMQ, with Redis as a cache only | Accepted |
| [0009](0009-aws-ecs.md) | AWS on ECS Fargate | Accepted |
| [0010](0010-multi-tenancy.md) | Application-layer tenancy, not RLS | Accepted |

## Format

**Context** — what forced a choice. **Decision** — what we did.
**Alternatives** — what we did not do, and why. **Consequences** — what we now
have to live with. **Revisit when** — the trigger.
