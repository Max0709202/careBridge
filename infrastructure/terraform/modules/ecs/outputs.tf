output "cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "service_name" {
  value = aws_ecs_service.api.name
}

output "task_definition_family" {
  value = aws_ecs_task_definition.api.family
}

output "alb_arn_suffix" {
  value       = aws_lb.this.arn_suffix
  description = "What CloudWatch metrics for this balancer are keyed on."
}

output "target_group_arn_suffix" {
  value = aws_lb_target_group.api.arn_suffix
}

output "url" {
  value = "https://${var.domain_name}"
}

output "execution_role_arn" {
  value = aws_iam_role.execution.arn
}

output "task_role_arn" {
  value = aws_iam_role.task.arn
}

output "log_group_name" {
  value = aws_cloudwatch_log_group.api.name
}
