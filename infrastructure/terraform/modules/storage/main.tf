# The document bucket and the image registry.

terraform {
  required_version = ">= 1.9"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }
}

# ─── driver documents ────────────────────────────────────────────────────────
#
# The most sensitive objects in the system: a licence scan carries a home
# address, a date of birth and a photograph — the three things the database
# deliberately has no column for. Everything below follows from that.

resource "aws_s3_bucket" "documents" {
  bucket = "${var.name}-documents"
  tags   = var.tags
}

# Every object private, and the account-level block on top. Four settings
# rather than one because they cover four different ways a bucket becomes
# public, and three of them have been the cause of a real breach somewhere.
resource "aws_s3_bucket_public_access_block" "documents" {
  bucket = aws_s3_bucket.documents.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "documents" {
  bucket = aws_s3_bucket.documents.id
  rule {
    # ACLs cannot grant anything, so the only path to an object is the bucket
    # policy and a pre-signed URL.
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

# Versioning, so a mistaken overwrite is recoverable — and because the
# application *supersedes* documents rather than replacing them, an overwrite
# here means something went wrong rather than something ordinary.
resource "aws_s3_bucket_versioning" "documents" {
  bucket = aws_s3_bucket.documents.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  # An upload slot the application authorised and nobody filled leaves a
  # multipart fragment behind. Collected rather than paid for forever.
  rule {
    id     = "abort-incomplete-uploads"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }

  # Superseded versions are kept long enough to undo an accident and no
  # longer. The *current* version of a superseded document is a row in the
  # database with `supersededAt` set — that is the copy retention law cares
  # about, and it is not managed here.
  rule {
    id     = "expire-old-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }

  depends_on = [aws_s3_bucket_versioning.documents]
}

# Refuses any request that did not arrive over TLS.
#
# The pre-signed URLs are https, so this should be unreachable — which is
# exactly why it is written down. A bucket policy is the only place this can be
# guaranteed rather than assumed.
data "aws_iam_policy_document" "documents" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.documents.arn, "${aws_s3_bucket.documents.arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "documents" {
  bucket = aws_s3_bucket.documents.id
  policy = data.aws_iam_policy_document.documents.json

  depends_on = [aws_s3_bucket_public_access_block.documents]
}

# Object-level access logged to its own bucket.
#
# "Who has seen this driver's licence" is answered by the application's audit
# log, which records the moment a URL was minted. This is the second half of
# that answer: whether the URL was ever used.
resource "aws_s3_bucket" "access_logs" {
  bucket = "${var.name}-documents-access-logs"
  tags   = var.tags
}

resource "aws_s3_bucket_public_access_block" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id

  rule {
    id     = "expire"
    status = "Enabled"
    filter {}
    expiration {
      days = 365
    }
  }
}

resource "aws_s3_bucket_logging" "documents" {
  bucket        = aws_s3_bucket.documents.id
  target_bucket = aws_s3_bucket.access_logs.id
  target_prefix = "documents/"
}

# ─── the image ───────────────────────────────────────────────────────────────

resource "aws_ecr_repository" "api" {
  name                 = "${var.name}-api"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = var.tags
}

# Immutable tags are the point of the registry configuration above: the image
# CI built and tested is the one that reaches production, and a mutable tag
# means "the thing called v1.2.3" can quietly become a different artefact.
resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep the last 30 images; a rollback never reaches further back than that."
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 30
        }
        action = { type = "expire" }
      },
    ]
  })
}
