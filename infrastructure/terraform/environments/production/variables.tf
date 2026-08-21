variable "region" {
  type    = string
  default = "us-east-1"
}

variable "domain_name" {
  type        = string
  description = "Where the family app and the API are served from."
}

variable "ops_domain_name" {
  type        = string
  description = "The dispatch console. A separate origin from the family app, deliberately."
}

variable "hosted_zone_id" {
  type        = string
  description = "Registered by a human. Terraform that owns a domain can release one."
}

variable "image" {
  type        = string
  description = "Only used to create the service. The pipeline updates it after that."
}

variable "alert_emails" {
  type    = list(string)
  default = []
}
