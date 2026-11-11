locals {
  name = var.service_name

  # Default lambda_zip_path to the committed artifact alongside this module
  # (infra-aws/src/lambda.zip). path.module cannot be used in a variable
  # default, so the default is null and resolved here.
  lambda_zip_path = coalesce(var.lambda_zip_path, "${path.module}/../../src/lambda.zip")

  # The Lambda execution role name is fixed so the KMS key policy can grant it
  # Encrypt/Decrypt without creating a kms <-> lambda module cycle.
  lambda_role_name = "${local.name}-lambda"
  lambda_role_arn  = "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:role/${local.lambda_role_name}"

  # When the Route 53 zone is in this account, Terraform owns the whole DNS
  # flow (ACM validation records + wait, and the custom-domain alias record).
  route53_managed = var.enable_custom_domain && var.route53_zone_id != ""

  lambda_environment = merge({
    GOOGLE_REDIRECT_URI    = "${var.issuer_url}/callback"
    ISSUER_URL             = var.issuer_url
    STORAGE                = "dynamodb"
    DYNAMODB_TABLE         = module.dynamodb.dynamodb_table_id
    CIPHER                 = "awskms"
    AWS_KMS_KEY_ID         = module.kms.key_arn
    GOOGLE_OAUTH_SECRET_ID = module.secret.secret_arn
    ALLOWED_DOMAIN         = var.allowed_domain
    ALLOWED_REDIRECT_URIS  = join(",", var.allowed_redirect_uris)
    TRUST_PROXY_HOPS       = "1"
    PUBLIC_PAGES           = var.public_pages
    ANALYTICS              = "false" # never report a shared server's visitors to upstream's analytics
    LOG_LEVEL              = "info"
  }, var.privacy_policy_url == "" ? {} : { PRIVACY_POLICY_URL = var.privacy_policy_url })
}

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
