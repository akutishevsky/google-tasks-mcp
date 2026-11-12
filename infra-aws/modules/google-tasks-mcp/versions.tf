terraform {
  # The official terraform-aws-modules used here (secrets-manager >= 1.11,
  # kms/acm/apigateway-v2 need AWS provider >= 6.28) set the floor.
  required_version = ">= 1.11"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}
