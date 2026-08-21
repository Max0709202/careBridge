# The load balancer, the cluster, the task and the WAF in front of it.

terraform {
  required_version = ">= 1.9"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }
}

# ─── certificate and DNS ─────────────────────────────────────────────────────

data "aws_route53_zone" "this" {
  zone_id = var.hosted_zone_id
}

resource "aws_acm_certificate" "this" {
  domain_name       = var.domain_name
  validation_method = "DNS"

  lifecycle {
    # A certificate is attached to a live listener. Replacing it before the
    # replacement exists is a minute of downtime for a renewal.
    create_before_destroy = true
  }

  tags = var.tags
}

resource "aws_route53_record" "certificate_validation" {
  for_each = {
    for option in aws_acm_certificate.this.domain_validation_options :
    option.domain_name => option
  }

  zone_id = data.aws_route53_zone.this.zone_id
  name    = each.value.resource_record_name
  type    = each.value.resource_record_type
  records = [each.value.resource_record_value]
  ttl     = 60

  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "this" {
  certificate_arn         = aws_acm_certificate.this.arn
  validation_record_fqdns = [for record in aws_route53_record.certificate_validation : record.fqdn]
}

# ─── load balancer ───────────────────────────────────────────────────────────

resource "aws_lb" "this" {
  name               = "${var.name}-alb"
  load_balancer_type = "application"
  subnets            = var.public_subnet_ids
  security_groups    = [var.alb_security_group_id]

  # A deploy in flight should not be interrupted by a `terraform destroy` typed
  # in the wrong terminal.
  enable_deletion_protection = var.deletion_protection

  # Longer than the sixty-second default, because this balancer carries
  # WebSockets: every live ride holds one open, and an idle timeout shorter
  # than the position cadence would disconnect a family's map on a quiet
  # stretch of road.
  idle_timeout = 300

  drop_invalid_header_fields = true

  access_logs {
    bucket  = var.access_logs_bucket
    prefix  = "alb"
    enabled = var.access_logs_bucket != ""
  }

  tags = var.tags
}

resource "aws_lb_target_group" "api" {
  name        = "${var.name}-api"
  port        = var.container_port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    # Readiness, not liveness. The balancer should stop sending traffic to a
    # task that cannot reach the database; the container should *not* be
    # restarted for it, which is why the two endpoints differ.
    path                = "/api/v1/health/ready"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  # Long enough for an in-flight request to finish, short enough that a deploy
  # is not spent waiting. WebSocket connections are closed by the gateway on
  # shutdown rather than waited out.
  deregistration_delay = 30

  stickiness {
    # Off. Every instance can serve every request: sessions are in a token,
    # rate-limit counters are in Redis, and live positions fan out through
    # Redis pub/sub. Stickiness here would only concentrate load.
    type    = "lb_cookie"
    enabled = false
  }

  tags = var.tags
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.this.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_route53_record" "api" {
  zone_id = data.aws_route53_zone.this.zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = aws_lb.this.dns_name
    zone_id                = aws_lb.this.zone_id
    evaluate_target_health = true
  }
}

# ─── WAF ─────────────────────────────────────────────────────────────────────

resource "aws_wafv2_web_acl" "this" {
  name  = "${var.name}-waf"
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  # A blunt ceiling in front of the application's own rate limiting, not a
  # replacement for it. The application's limits are per account and per
  # endpoint and know what a password attempt is; this one only knows how to
  # stop one address making five thousand requests in five minutes.
  rule {
    name     = "rate-limit"
    priority = 1

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = var.waf_rate_limit
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "common-rules"
    priority = 2

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"

        # This rule inspects bodies and would reject a legitimate document
        # upload — except that documents never pass through the API at all;
        # they go straight to S3 with a pre-signed URL. Excluded anyway,
        # because the webhook endpoint receives a signed JSON body whose bytes
        # must arrive exactly as sent, and a WAF that mangles it breaks a
        # signature check with an error nobody can trace.
        rule_action_override {
          name = "SizeRestrictions_BODY"
          action_to_use {
            count {}
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-common"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "known-bad-inputs"
    priority = 3

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.name}-waf"
    sampled_requests_enabled   = true
  }

  tags = var.tags
}

resource "aws_wafv2_web_acl_association" "this" {
  resource_arn = aws_lb.this.arn
  web_acl_arn  = aws_wafv2_web_acl.this.arn
}

# ─── the cluster and the task ────────────────────────────────────────────────

resource "aws_ecs_cluster" "this" {
  name = var.name

  setting {
    name  = "containerInsights"
    value = var.container_insights ? "enabled" : "disabled"
  }

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${var.name}/api"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

data "aws_iam_policy_document" "assume_ecs_tasks" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# The role that *starts* the container: pulls the image and reads the secrets
# to inject. Separate from the role the application runs as, so a flaw in the
# application cannot read a secret it was not given.
resource "aws_iam_role" "execution" {
  name               = "${var.name}-execution"
  assume_role_policy = data.aws_iam_policy_document.assume_ecs_tasks.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_secrets" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = var.secret_arns
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "read-secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

# The role the application runs as.
#
# It can put and get objects in the document bucket and nothing else. No
# secrets, no other buckets, no `s3:*`. This is what makes the S3 adapter's
# "credentials are optional" note true: the container has a role, so there are
# no keys in the environment to leak, rotate or commit.
resource "aws_iam_role" "task" {
  name               = "${var.name}-task"
  assume_role_policy = data.aws_iam_policy_document.assume_ecs_tasks.json
  tags               = var.tags
}

data "aws_iam_policy_document" "task_documents" {
  statement {
    actions   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
    resources = ["${var.documents_bucket_arn}/*"]
  }

  # Deliberately no `s3:ListBucket`. The application always knows the key it
  # wants; a role that can list is a role that can enumerate every driver's
  # documents, which is the thing the opaque key naming exists to prevent.
}

resource "aws_iam_role_policy" "task_documents" {
  name   = "documents"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task_documents.json
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${var.name}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([
    {
      name      = "api"
      image     = var.image
      essential = true

      portMappings = [{ containerPort = var.container_port, protocol = "tcp" }]

      environment = [
        for key, value in var.environment : { name = key, value = value }
      ]

      # Read from Secrets Manager at start, never baked into the image and
      # never visible in a task definition revision.
      secrets = [
        for key, arn in var.secrets : { name = key, valueFrom = arn }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.api.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "api"
        }
      }

      # Liveness, deliberately: it checks nothing external, so a database blip
      # cannot turn a recoverable outage into a crash loop. The load balancer
      # asks the readiness endpoint instead, and takes the task out of
      # rotation without killing it.
      healthCheck = {
        command     = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:${var.container_port}/api/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 30
      }

      # Nothing here writes to its own filesystem: uploads go straight to S3
      # and logs go to stdout. Making that a guarantee rather than a habit
      # closes off a whole class of "somebody wrote a temp file with a
      # passenger's address in it".
      readonlyRootFilesystem = true
      linuxParameters = {
        initProcessEnabled = true
      }
    },
  ])

  tags = var.tags
}

resource "aws_ecs_service" "api" {
  name            = "${var.name}-api"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.tasks_security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = var.container_port
  }

  # A rolling deploy that never drops below the current capacity and never runs
  # more than double it. With `desired_count = 2` that means one new task at a
  # time — and it is why migrations must be backwards-compatible: for the
  # length of a deploy, both versions are live.
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable = true
    # Rolls back to the previous task definition on its own. A deploy that
    # fails at three in the morning should not wait for somebody to notice.
    rollback = true
  }

  health_check_grace_period_seconds = 60

  # The pipeline updates the image, not Terraform. Without this, every
  # `terraform apply` would try to drag the service back to whatever tag was
  # last committed here.
  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }

  tags = var.tags

  depends_on = [aws_lb_listener.https]
}

# ─── scaling ─────────────────────────────────────────────────────────────────

resource "aws_appautoscaling_target" "api" {
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.this.name}/${aws_ecs_service.api.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.min_capacity
  max_capacity       = var.max_capacity
}

# Scaled on CPU rather than on request count, because the load that actually
# costs this service is the WebSocket fan-out for live rides — which is a held
# connection rather than a request, and does not appear in a request count at
# all.
resource "aws_appautoscaling_policy" "api_cpu" {
  name               = "${var.name}-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.api.service_namespace
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value = 60

    # Slow to scale in, quick to scale out. Removing a task drops every
    # WebSocket it was holding, and a family's map reconnecting is a visible
    # event; adding one costs money and nothing else.
    scale_in_cooldown  = 600
    scale_out_cooldown = 60
  }
}
