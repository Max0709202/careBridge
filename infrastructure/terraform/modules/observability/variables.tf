variable "name" { type = string }

variable "alert_emails" {
  type        = list(string)
  description = "Confirmed by hand once — AWS sends each address a subscription email."
  default     = []
}

variable "alb_arn_suffix" { type = string }
variable "target_group_arn_suffix" { type = string }
variable "db_instance_id" { type = string }
variable "log_group_name" { type = string }

variable "metric_namespace" {
  type    = string
  default = "CareBridge"
}

variable "error_threshold" {
  type        = number
  description = "5xx responses in five minutes before paging."
  default     = 10
}

variable "latency_threshold_seconds" {
  type    = number
  default = 1.5
}

variable "stale_tracking_threshold" {
  type        = number
  description = <<-EOT
    Rides in flight with no recent position, in five minutes.

    Zero would page on a single driver entering a tunnel, which is ordinary.
    This is set to catch a pattern rather than an event.
  EOT
  default     = 3
}

variable "payment_failure_threshold" {
  type    = number
  default = 5
}

variable "tags" {
  type    = map(string)
  default = {}
}
