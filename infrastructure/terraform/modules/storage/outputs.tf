output "documents_bucket" {
  value = aws_s3_bucket.documents.bucket
}

output "documents_bucket_arn" {
  value = aws_s3_bucket.documents.arn
}

output "ecr_repository_url" {
  value = aws_ecr_repository.api.repository_url
}
