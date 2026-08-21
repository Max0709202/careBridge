variable "name" { type = string }
variable "isolated_subnet_ids" { type = list(string) }
variable "data_security_group_id" { type = string }

variable "db_instance_class" {
  type    = string
  default = "db.t4g.small"
}

variable "db_allocated_storage" {
  type    = number
  default = 20
}

variable "redis_node_type" {
  type    = string
  default = "cache.t4g.micro"
}

variable "multi_az" {
  type        = bool
  description = "Standby in a second zone, for both Postgres and Redis."
  default     = false
}

variable "backup_retention_days" {
  type        = number
  description = <<-EOT
    Postgres automated backups.

    Thirty days in production, matching the retention the privacy documents
    promise for location samples — a backup that outlives the data it contains
    is a retention policy that is not true.
  EOT
  default     = 7
}

variable "deletion_protection" {
  type        = bool
  description = "Refuses to delete the database, and takes a final snapshot."
  default     = false
}

variable "tags" {
  type    = map(string)
  default = {}
}
