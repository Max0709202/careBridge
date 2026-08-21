# Production. The pilot.

terraform {
  required_version = ">= 1.9"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = local.tags
  }
}

locals {
  name = "carebridge-production"

  tags = {
    Project     = "carebridge"
    Environment = "production"
    ManagedBy   = "terraform"
  }
}

module "network" {
  source = "../../modules/network"

  name   = local.name
  region = var.region
  # One NAT per zone. A single NAT is a single point of failure for outbound
  # traffic, which here means Stripe, Google and FCM — and a family's ride
  # notification.
  single_nat_gateway = false
  tags               = local.tags
}

module "storage" {
  source = "../../modules/storage"

  name = local.name
  tags = local.tags
}

module "data" {
  source = "../../modules/data"

  name                   = local.name
  isolated_subnet_ids    = module.network.isolated_subnet_ids
  data_security_group_id = module.network.data_security_group_id

  db_instance_class    = "db.t4g.medium"
  db_allocated_storage = 100
  redis_node_type      = "cache.t4g.small"

  multi_az = true
  # Thirty days, matching the retention the privacy documents promise for
  # location samples. A backup that outlives the data it contains is a
  # retention policy that is not true.
  backup_retention_days = 30
  deletion_protection   = true

  tags = local.tags
}

module "ecs" {
  source = "../../modules/ecs"

  name   = local.name
  region = var.region

  vpc_id                  = module.network.vpc_id
  public_subnet_ids       = module.network.public_subnet_ids
  private_subnet_ids      = module.network.private_subnet_ids
  alb_security_group_id   = module.network.alb_security_group_id
  tasks_security_group_id = module.network.tasks_security_group_id

  domain_name    = var.domain_name
  hosted_zone_id = var.hosted_zone_id

  image                = var.image
  documents_bucket_arn = module.storage.documents_bucket_arn

  task_cpu      = 1024
  task_memory   = 2048
  desired_count = 2
  min_capacity  = 2
  max_capacity  = 10

  container_insights  = true
  log_retention_days  = 90
  deletion_protection = true

  environment = {
    NODE_ENV     = "production"
    PORT         = "3000"
    CORS_ORIGINS = "https://${var.domain_name},https://${var.ops_domain_name}"

    PUBLIC_APP_URL = "https://${var.domain_name}"

    # Every adapter is the real one. Production refuses the local ones at boot
    # anyway — this is what makes that check pass rather than what makes it
    # unnecessary.
    MAIL_DRIVER     = "smtp"
    PUSH_DRIVER     = "fcm"
    MAPS_DRIVER     = "google"
    PAYMENTS_DRIVER = "stripe"
    STORAGE_DRIVER  = "s3"

    STORAGE_BUCKET = module.storage.documents_bucket
    STORAGE_REGION = var.region
    # No access keys. The task role above is how the container reaches S3, so
    # there is nothing here to leak, rotate or commit.
  }

  secrets = {
    DATABASE_URL   = "${module.data.app_secret_arn}:DATABASE_URL::"
    REDIS_URL      = "${module.data.app_secret_arn}:REDIS_URL::"
    JWT_SECRET     = "${module.data.app_secret_arn}:JWT_SECRET::"
    MFA_SECRET_KEY = "${module.data.app_secret_arn}:MFA_SECRET_KEY::"

    MAPS_API_KEY             = "${module.data.vendor_secret_arn}:MAPS_API_KEY::"
    STRIPE_SECRET_KEY        = "${module.data.vendor_secret_arn}:STRIPE_SECRET_KEY::"
    STRIPE_WEBHOOK_SECRET    = "${module.data.vendor_secret_arn}:STRIPE_WEBHOOK_SECRET::"
    FCM_SERVICE_ACCOUNT_JSON = "${module.data.vendor_secret_arn}:FCM_SERVICE_ACCOUNT_JSON::"
    MAIL_SMTP_HOST           = "${module.data.vendor_secret_arn}:MAIL_SMTP_HOST::"
    MAIL_SMTP_USER           = "${module.data.vendor_secret_arn}:MAIL_SMTP_USER::"
    MAIL_SMTP_PASSWORD       = "${module.data.vendor_secret_arn}:MAIL_SMTP_PASSWORD::"
  }

  secret_arns = [module.data.app_secret_arn, module.data.vendor_secret_arn]

  tags = local.tags
}

module "observability" {
  source = "../../modules/observability"

  name         = local.name
  alert_emails = var.alert_emails

  alb_arn_suffix          = module.ecs.alb_arn_suffix
  target_group_arn_suffix = module.ecs.target_group_arn_suffix
  db_instance_id          = "${local.name}-postgres"
  log_group_name          = module.ecs.log_group_name

  tags = local.tags
}
