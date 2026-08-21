output "app_secret_arn" {
  value = aws_secretsmanager_secret.app.arn
}

output "vendor_secret_arn" {
  value = aws_secretsmanager_secret.vendors.arn
}

output "database_endpoint" {
  value = aws_db_instance.this.endpoint
}

output "redis_endpoint" {
  value = aws_elasticache_replication_group.this.primary_endpoint_address
}
