# State in S3, locked in DynamoDB.
#
# Neither is managed by this Terraform. A state backend that Terraform creates
# is a state backend Terraform can destroy, and recovering from that is worse
# than the three CLI commands in bootstrap.md.
terraform {
  backend "s3" {
    bucket         = "carebridge-terraform-state"
    key            = "staging/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "carebridge-terraform-locks"
    encrypt        = true
  }
}
