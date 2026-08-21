# Postgres, Redis and the secrets that reach them.
#
# Both sit in the isolated subnets, which have no route to a NAT gateway. A
# database that cannot reach the internet cannot be exfiltrated to it, and
# nothing in Postgres needs to make an outbound call.

terraform {
  required_version = ">= 1.9"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

# ─── Postgres ────────────────────────────────────────────────────────────────

resource "aws_db_subnet_group" "this" {
  name       = "${var.name}-db"
  subnet_ids = var.isolated_subnet_ids
  tags       = var.tags
}

resource "random_password" "postgres" {
  length = 40
  # Excludes characters that need escaping inside a URI. `DATABASE_URL` is a
  # connection string, and a password containing `@` or `/` produces an error
  # that looks like a wrong host rather than a wrong password.
  override_special = "!#$%*()-_=+[]{}<>:?"
}

resource "aws_db_parameter_group" "this" {
  name   = "${var.name}-pg16"
  family = "postgres16"

  # Refuses an unencrypted connection outright rather than merely offering TLS.
  # The API is inside the VPC either way; this is the setting that makes that
  # a guarantee instead of a default.
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  # Anything slower than a second is worth seeing. Below that the log becomes
  # noise nobody reads, which is the same as not having one.
  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }

  tags = var.tags
}

resource "aws_db_instance" "this" {
  identifier     = "${var.name}-postgres"
  engine         = "postgres"
  engine_version = "16.4"

  instance_class    = var.db_instance_class
  allocated_storage = var.db_allocated_storage
  # Grows on its own before it fills. A database that stops accepting writes at
  # three in the morning is an outage; a slightly larger bill is not.
  max_allocated_storage = var.db_allocated_storage * 4
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = "carebridge"
  username = "carebridge"
  password = random_password.postgres.result
  port     = 5432

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [var.data_security_group_id]
  parameter_group_name   = aws_db_parameter_group.this.name

  multi_az            = var.multi_az
  publicly_accessible = false

  backup_retention_period = var.backup_retention_days
  # Backup first, then maintenance, both outside the hours anybody books a
  # medical appointment for.
  backup_window      = "07:00-08:00"
  maintenance_window = "Mon:08:30-Mon:09:30"

  # Patch releases only. A minor version arriving unannounced during a pilot is
  # a variable nobody asked for.
  auto_minor_version_upgrade = false

  performance_insights_enabled    = var.multi_az
  enabled_cloudwatch_logs_exports = ["postgresql"]

  deletion_protection       = var.deletion_protection
  skip_final_snapshot       = !var.deletion_protection
  final_snapshot_identifier = var.deletion_protection ? "${var.name}-final-${formatdate("YYYYMMDDhhmmss", timestamp())}" : null

  # Applied in the maintenance window rather than immediately, so a plan run at
  # lunchtime does not restart the database at lunchtime.
  apply_immediately = false

  tags = var.tags

  lifecycle {
    # The snapshot identifier contains a timestamp, so it differs on every
    # plan. Ignoring it keeps `terraform plan` honest about what is actually
    # changing.
    ignore_changes = [final_snapshot_identifier]
  }
}

# ─── Redis ───────────────────────────────────────────────────────────────────

resource "aws_elasticache_subnet_group" "this" {
  name       = "${var.name}-redis"
  subnet_ids = var.isolated_subnet_ids
  tags       = var.tags
}

resource "random_password" "redis" {
  length  = 48
  special = false
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id = "${var.name}-redis"
  description          = "Cache, scheduler and live-position fan-out"

  engine         = "redis"
  engine_version = "7.1"
  node_type      = var.redis_node_type
  port           = 6379

  # Two nodes in production, one in staging. Redis is never the source of
  # truth here — but it does carry the live-position fan-out, and losing it
  # mid-shift means every family's map stops at once.
  num_cache_clusters         = var.multi_az ? 2 : 1
  automatic_failover_enabled = var.multi_az
  multi_az_enabled           = var.multi_az

  subnet_group_name  = aws_elasticache_subnet_group.this.name
  security_group_ids = [var.data_security_group_id]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = random_password.redis.result

  # The scheduler's jobs are re-derivable from the database, so a snapshot
  # buys nothing that a restart does not. Kept off deliberately rather than by
  # omission.
  snapshot_retention_limit = 0

  maintenance_window = "Mon:09:30-Mon:10:30"
  apply_immediately  = false

  tags = var.tags
}

# ─── secrets ─────────────────────────────────────────────────────────────────
#
# Composed here and read by the task definition as `secrets`, so they reach the
# container as environment variables without ever appearing in an image, a
# repository, a plan output or a client bundle.

resource "random_password" "jwt" {
  length  = 64
  special = false
}

resource "random_password" "mfa_key" {
  length  = 32
  special = false
}

resource "aws_secretsmanager_secret" "app" {
  name = "${var.name}/app"
  # Long enough to undo a mistake, short enough that a rotated credential is
  # genuinely gone. Zero would make a fat-fingered destroy unrecoverable.
  recovery_window_in_days = 7
  tags                    = var.tags
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({
    DATABASE_URL   = "postgresql://${aws_db_instance.this.username}:${urlencode(random_password.postgres.result)}@${aws_db_instance.this.endpoint}/${aws_db_instance.this.db_name}?schema=public&sslmode=require"
    REDIS_URL      = "rediss://:${urlencode(random_password.redis.result)}@${aws_elasticache_replication_group.this.primary_endpoint_address}:6379"
    JWT_SECRET     = random_password.jwt.result
    MFA_SECRET_KEY = random_password.mfa_key.result
  })
}

# The vendor credentials, created empty and filled in by a human.
#
# Terraform that creates billing relationships is Terraform that can cancel
# them, so the Stripe keys, the maps key and the FCM service account are put
# here out of band. The resource exists so the task definition has something to
# reference and so a missing value fails at boot rather than at first use.
resource "aws_secretsmanager_secret" "vendors" {
  name                    = "${var.name}/vendors"
  recovery_window_in_days = 7
  tags                    = var.tags
}
