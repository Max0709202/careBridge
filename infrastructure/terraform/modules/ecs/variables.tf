variable "name" { type = string }
variable "region" { type = string }

variable "vpc_id" { type = string }
variable "public_subnet_ids" { type = list(string) }
variable "private_subnet_ids" { type = list(string) }
variable "alb_security_group_id" { type = string }
variable "tasks_security_group_id" { type = string }

variable "domain_name" { type = string }
variable "hosted_zone_id" { type = string }

variable "image" {
  type        = string
  description = <<-EOT
    The tag Terraform first creates the service with.

    The pipeline updates it after that, and the service ignores changes to
    `task_definition` — otherwise every `terraform apply` would drag production
    back to whatever tag was last committed here.
  EOT
}

variable "container_port" {
  type    = number
  default = 3000
}

variable "environment" {
  type        = map(string)
  description = "Plain configuration. Anything secret goes in `secrets`."
  default     = {}
}

variable "secrets" {
  type        = map(string)
  description = "Environment variable name to Secrets Manager ARN (with a JSON key)."
  default     = {}
}

variable "secret_arns" {
  type        = list(string)
  description = "The secrets the execution role may read, without JSON keys."
  default     = []
}

variable "documents_bucket_arn" { type = string }

variable "access_logs_bucket" {
  type    = string
  default = ""
}

variable "task_cpu" {
  type    = number
  default = 512
}

variable "task_memory" {
  type    = number
  default = 1024
}

variable "desired_count" {
  type    = number
  default = 2
}

variable "min_capacity" {
  type    = number
  default = 2
}

variable "max_capacity" {
  type    = number
  default = 6
}

variable "waf_rate_limit" {
  type        = number
  description = "Requests per five minutes from one address before blocking."
  default     = 3000
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "container_insights" {
  type    = bool
  default = false
}

variable "deletion_protection" {
  type    = bool
  default = false
}

variable "tags" {
  type    = map(string)
  default = {}
}
