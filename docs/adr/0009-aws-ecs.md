# ADR-0009 · AWS on ECS Fargate

**Status:** Accepted · **Date:** 2026-07-27 · **Implemented:** Stage 4

## Context

We need managed equivalents for every component we would otherwise operate, and
a provider that will sign a BAA covering the services we use — because the
architecture assumes the strictest interpretation of our legal role (L1).

## Decision

**AWS**, with the application on **ECS Fargate**.

RDS · ElastiCache · S3 · ALB · Secrets Manager · CloudWatch · Route 53 · ACM ·
WAF · ECR. Terraform for staging and production.

**The deliberate constraint: no AWS service enters the MVP without a stated
need.** No EKS, no Step Functions, no Kinesis, no Lambda.

## Alternatives

**Kubernetes (EKS).** More control, and a cluster to operate. At one service
and one team, the control is not useful and the operation is a real cost.
Rejected until there is a scaling or topology need that Fargate cannot meet.

**Fly.io / Render / Railway.** Materially better developer experience and
faster to stand up. Against them: BAA availability is the blocker, and it is
not negotiable given L1.

**GCP or Azure.** Comparable. AWS wins on our familiarity and on RDS being the
most boring possible Postgres, which is what we want it to be.

## Consequences

- Fargate removes node management entirely at our scale.
- Encryption at rest by default via KMS, across RDS, ElastiCache, S3 and EBS.
- Containers are the deployment unit *and* the local development unit, so the
  image tested in CI is the artefact deployed to production.
- **Lock-in is bounded** by keeping business logic in the container and vendor
  calls behind interfaces. What is genuinely AWS-shaped is the Terraform, and
  that is the part we would expect to rewrite in a migration anyway.
- A BAA must be executed **before real patient data flows** (L3). This is a
  contractual precondition of the pilot, not a launch task.

## Revisit when

- Multi-region becomes a requirement (Stage 5E) — a cost decision as much as an
  engineering one.
- Fargate's cold-start or scaling behaviour becomes a measured problem under
  the tracking load.
- Not for cost alone at pilot scale: the difference is smaller than the
  engineering time to move.
