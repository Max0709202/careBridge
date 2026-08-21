# Alarms.
#
# Each one is here because somebody would have to be telephoned about it. An
# alarm nobody acts on is a page that trains people to ignore pages, so the
# list is short and every entry names a person's next move.

terraform {
  required_version = ">= 1.9"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }
}

resource "aws_sns_topic" "alerts" {
  name = "${var.name}-alerts"
  tags = var.tags
}

resource "aws_sns_topic_subscription" "email" {
  for_each = toset(var.alert_emails)

  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = each.value
}

locals {
  alarm_actions = [aws_sns_topic.alerts.arn]
}

# ─── the application is answering ────────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "unhealthy_hosts" {
  alarm_name          = "${var.name}-unhealthy-tasks"
  alarm_description   = "Tasks are failing the readiness check. Look at the API logs, then at the database."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "UnHealthyHostCount"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"

  dimensions = {
    LoadBalancer = var.alb_arn_suffix
    TargetGroup  = var.target_group_arn_suffix
  }

  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions
  # Missing data means the balancer is reporting nothing, which is not "fine".
  treat_missing_data = "breaching"

  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "server_errors" {
  alarm_name          = "${var.name}-5xx"
  alarm_description   = "The API is returning errors. Correlate by the correlation id in the logs."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = var.error_threshold
  comparison_operator = "GreaterThanThreshold"

  dimensions = {
    LoadBalancer = var.alb_arn_suffix
    TargetGroup  = var.target_group_arn_suffix
  }

  alarm_actions = local.alarm_actions
  # Not breaching: no requests is a quiet night, not an outage. The unhealthy
  # host alarm above is what catches "nothing is answering".
  treat_missing_data = "notBreaching"

  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "latency" {
  alarm_name          = "${var.name}-p95-latency"
  alarm_description   = "The API is slow. Check the database's CPU and the routing vendor's circuit breaker."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "TargetResponseTime"
  extended_statistic  = "p95"
  period              = 300
  evaluation_periods  = 2
  threshold           = var.latency_threshold_seconds
  comparison_operator = "GreaterThanThreshold"

  dimensions = {
    LoadBalancer = var.alb_arn_suffix
    TargetGroup  = var.target_group_arn_suffix
  }

  alarm_actions      = local.alarm_actions
  treat_missing_data = "notBreaching"

  tags = var.tags
}

# ─── the data tier ───────────────────────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "database_cpu" {
  alarm_name          = "${var.name}-db-cpu"
  alarm_description   = "Postgres is saturated. Look at the slow query log before resizing anything."
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"

  dimensions = { DBInstanceIdentifier = var.db_instance_id }

  alarm_actions      = local.alarm_actions
  treat_missing_data = "notBreaching"

  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "database_storage" {
  alarm_name          = "${var.name}-db-storage"
  alarm_description   = "Postgres is running out of room. Autoscaling should have grown it; find out why it did not."
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5 * 1024 * 1024 * 1024
  comparison_operator = "LessThanThreshold"

  dimensions = { DBInstanceIdentifier = var.db_instance_id }

  alarm_actions      = local.alarm_actions
  treat_missing_data = "breaching"

  tags = var.tags
}

# ─── the ones that are about this product ────────────────────────────────────
#
# Everything above would be on any web service. These three are the ones that
# mean something specific went wrong with rides, money or paperwork, and they
# are read from the application's own structured logs.

resource "aws_cloudwatch_log_metric_filter" "stale_tracking" {
  name           = "${var.name}-stale-tracking"
  log_group_name = var.log_group_name
  # Emitted by the staleness watchdog when a ride in flight has not reported a
  # position inside the freshness bound.
  pattern = "{ $.event = \"tracking.stale\" }"

  metric_transformation {
    name          = "StaleTrackingRides"
    namespace     = var.metric_namespace
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "stale_tracking" {
  alarm_name = "${var.name}-stale-tracking"
  alarm_description = join(" ", [
    "Rides are in flight with no recent position.",
    "This is the alarm specific to this product: a family is watching a map that has stopped.",
    "Telephone the dispatcher before looking at anything technical.",
  ])
  namespace           = var.metric_namespace
  metric_name         = "StaleTrackingRides"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = var.stale_tracking_threshold
  comparison_operator = "GreaterThanThreshold"

  alarm_actions      = local.alarm_actions
  treat_missing_data = "notBreaching"

  tags = var.tags
}

resource "aws_cloudwatch_log_metric_filter" "payment_failures" {
  name           = "${var.name}-payment-failures"
  log_group_name = var.log_group_name
  pattern        = "{ $.event = \"billing.payment_failed\" }"

  metric_transformation {
    name          = "PaymentFailures"
    namespace     = var.metric_namespace
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "payment_failures" {
  alarm_name = "${var.name}-payment-failures"
  alarm_description = join(" ", [
    "Card declines are above the usual rate.",
    "A spike that is not spread across accounts is usually the processor rather than the cards.",
  ])
  namespace           = var.metric_namespace
  metric_name         = "PaymentFailures"
  statistic           = "Sum"
  period              = 900
  evaluation_periods  = 1
  threshold           = var.payment_failure_threshold
  comparison_operator = "GreaterThanThreshold"

  alarm_actions      = local.alarm_actions
  treat_missing_data = "notBreaching"

  tags = var.tags
}

resource "aws_cloudwatch_log_metric_filter" "routing_circuit_open" {
  name           = "${var.name}-routing-circuit-open"
  log_group_name = var.log_group_name
  pattern        = "\"Routing circuit opened\""

  metric_transformation {
    name          = "RoutingCircuitOpen"
    namespace     = var.metric_namespace
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "routing_circuit_open" {
  alarm_name = "${var.name}-routing-circuit-open"
  alarm_description = join(" ", [
    "The routing vendor is failing and the breaker has opened.",
    "Arrival estimates have fallen back to straight-line distance — degraded, not broken.",
    "Check the vendor's status page and the API key's quota.",
  ])
  namespace           = var.metric_namespace
  metric_name         = "RoutingCircuitOpen"
  statistic           = "Sum"
  period              = 900
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"

  alarm_actions      = local.alarm_actions
  treat_missing_data = "notBreaching"

  tags = var.tags
}
