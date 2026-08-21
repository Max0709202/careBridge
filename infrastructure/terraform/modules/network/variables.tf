variable "name" {
  type        = string
  description = "Prefix for every resource name."
}

variable "region" {
  type        = string
  description = "Used for the S3 gateway endpoint's service name."
}

variable "cidr_block" {
  type        = string
  description = "The VPC range. /16, so the /20 subnets below fit twice over."
  default     = "10.0.0.0/16"
}

variable "container_port" {
  type    = number
  default = 3000
}

variable "single_nat_gateway" {
  type        = bool
  description = <<-EOT
    One NAT for the whole VPC instead of one per zone.

    A single NAT is a single point of failure for outbound traffic, which here
    means Stripe, Google and FCM. Acceptable in staging, where an outage costs
    an afternoon; not in production, where it costs a family's ride
    notification.
  EOT
  default     = false
}

variable "tags" {
  type    = map(string)
  default = {}
}
