# Staging: production-shaped, not production-sized.
#
# The same modules and the same wiring, so a change is exercised against the
# shape it will meet. Smaller instances, one NAT gateway, no standby — because
# the point is to rehearse the deploy, not to double the bill learning that.
#
# The one thing it does not share is data. Fictional records only, from the
# same seed `make seed` loads.

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
  name = "carebridge-staging"

  tags = {
    Project     = "carebridge"
    Environment = "staging"
    ManagedBy   = "terraform"
  }
}

module "network" {
  source = "../../modules/network"

  name   = local.name
  region = var.region
  # One NAT. An outage here costs an afternoon rather than a family's ride.
  single_nat_gateway = true
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

  db_instance_class    = "db.t4g.small"
  db_allocated_storage = 20
  redis_node_type      = "cache.t4g.micro"

  multi_az              = false
  backup_retention_days = 7
  # Deliberately destroyable. Staging carries fictional data, and being able to
  # tear it down and rebuild is how the Terraform itself gets exercised.
  deletion_protection = false

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

  task_cpu      = 512
  task_memory   = 1024
  desired_count = 1
  min_capacity  = 1
  max_capacity  = 2

  container_insights  = false
  log_retention_days  = 14
  deletion_protection = false

  environment = {
    NODE_ENV     = "production"
    PORT         = "3000"
    CORS_ORIGINS = "https://${var.domain_name},https://${var.ops_domain_name}"

    PUBLIC_APP_URL = "https://${var.domain_name}"

    # Real adapters, exactly as production. Staging with the log-only mail
    # adapter would be a staging that cannot rehearse the one thing most likely
    # to be misconfigured — and `NODE_ENV=production` above means the config
    # validator refuses them anyway.
    MAIL_DRIVER     = "smtp"
    PUSH_DRIVER     = "fcm"
    MAPS_DRIVER     = "google"
    PAYMENTS_DRIVER = "stripe"
    STORAGE_DRIVER  = "s3"

    STORAGE_BUCKET = module.storage.documents_bucket
    STORAGE_REGION = var.region
  }

  secrets = {
    DATABASE_URL   = "${module.data.app_secret_arn}:DATABASE_URL::"
    REDIS_URL      = "${module.data.app_secret_arn}:REDIS_URL::"
    JWT_SECRET     = "${module.data.app_secret_arn}:JWT_SECRET::"
    MFA_SECRET_KEY = "${module.data.app_secret_arn}:MFA_SECRET_KEY::"

    # Stripe's **test** keys here. The same variable names, so the code path is
    # identical and a misconfiguration surfaces in staging rather than against
    # a real card.
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

  # Looser than production. Staging is where deliberately broken things are
  # tried, and an alarm that fires every afternoon is an alarm people mute.
  error_threshold          = 50
  stale_tracking_threshold = 20

  tags = local.tags
}
