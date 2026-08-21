# Terraform

Two environments, one set of modules, and a deliberate asymmetry between them.

```
modules/
  network/        VPC, subnets, NAT, security groups
  data/           RDS Postgres, ElastiCache Redis, Secrets Manager
  storage/        S3 for driver documents, ECR for the image
  ecs/            cluster, task definition, service, ALB, WAF
  observability/  log groups, alarms, the SNS topic they page
environments/
  staging/        production-shaped, fictional data only
  production/     the pilot
```

## Running it

```bash
cd environments/staging
terraform init
terraform plan
```

State lives in S3 with DynamoDB locking, configured per environment in
`backend.tf`. The bucket and table are **not** managed by this Terraform: a
state backend that Terraform creates is a state backend Terraform can destroy,
and the bootstrap for them is three CLI commands documented in
`bootstrap.md` rather than a chicken-and-egg module.

## What staging is for

Production-shaped, not production-sized. Same modules, same wiring, smaller
instances and a single NAT gateway — so a change is exercised against the shape
it will meet, and the bill is not doubled to learn that.

The one thing staging does **not** share is data. It carries fictional records
only, and the seed is the same one `make seed` loads.

## What is deliberately not here

- **The Stripe account, the Google Maps key and the domain registration.**
  Bought by a human, referenced by ARN. Terraform that creates billing
  relationships is Terraform that can cancel them.
- **A `terraform destroy` path for production.** The RDS instance carries
  `prevent_destroy`. Recovering a deleted database from a snapshot is in
  [disaster-recovery](../../docs/architecture/disaster-recovery.md); making it
  easy to reach that path is not a feature.
