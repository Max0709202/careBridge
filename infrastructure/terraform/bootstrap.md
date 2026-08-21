# Bootstrap

Three things exist before Terraform runs, and none of them is managed by it.

## The state backend

A state backend Terraform creates is a state backend Terraform can destroy —
and recovering from that means reconstructing the mapping between every
resource and its address by hand.

```bash
aws s3api create-bucket --bucket carebridge-terraform-state --region us-east-1
aws s3api put-bucket-versioning --bucket carebridge-terraform-state \
  --versioning-configuration Status=Enabled
aws s3api put-public-access-block --bucket carebridge-terraform-state \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

aws dynamodb create-table --table-name carebridge-terraform-locks \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST
```

Versioning on the bucket is the one that matters. It is the difference between
a corrupted state file being an inconvenience and being an afternoon.

## The domain

Registered by a human, in Route 53. Terraform that owns a domain is Terraform
that can release one, and a lapsed domain is not a recoverable mistake.

Pass the zone id in as `hosted_zone_id`.

## The vendor credentials

`terraform apply` creates `carebridge-<env>/vendors` **empty**. Fill it once:

```bash
aws secretsmanager put-secret-value \
  --secret-id carebridge-staging/vendors \
  --secret-string '{
    "MAPS_API_KEY": "…",
    "STRIPE_SECRET_KEY": "sk_test_…",
    "STRIPE_WEBHOOK_SECRET": "whsec_…",
    "FCM_SERVICE_ACCOUNT_JSON": "{…}",
    "MAIL_SMTP_HOST": "…",
    "MAIL_SMTP_USER": "…",
    "MAIL_SMTP_PASSWORD": "…"
  }'
```

Terraform that creates billing relationships is Terraform that can cancel them.
These are bought by a person and referenced by ARN.

The API refuses to start without them, by name, in its first second — so a
missing value is a container that will not boot rather than a feature that
quietly does nothing.

## First apply

```bash
cd environments/staging
terraform init
terraform apply -var-file=staging.tfvars
```

`image` on the first apply is whatever is already in ECR — usually
`…/carebridge-staging-api:bootstrap`, pushed by hand. After that the pipeline
owns it, and the service ignores Terraform's opinion of the task definition.
