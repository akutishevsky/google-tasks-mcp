locals {
  name = var.service_name

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

# --- DynamoDB: single-table store -------------------------------------------

# pk (partition) + sk (sort), both strings; numeric `ttl` attribute (epoch
# seconds) drives DynamoDB TTL. The server checks `expiresAt` (epoch ms) on
# every read, so DynamoDB TTL is garbage collection only.
module "dynamodb" {
  source  = "terraform-aws-modules/dynamodb-table/aws"
  version = "5.5.2"

  name         = local.name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attributes = [
    { name = "pk", type = "S" },
    { name = "sk", type = "S" },
  ]

  ttl_enabled        = true
  ttl_attribute_name = "ttl"

  point_in_time_recovery_enabled = true
}

# --- KMS: per-token encryption ----------------------------------------------

module "kms" {
  source  = "terraform-aws-modules/kms/aws"
  version = "4.2.2"

  description         = "${local.name} token encryption (per-token KMS Encrypt/Decrypt)"
  enable_key_rotation = true

  aliases = ["${local.name}-tokens"]

  # Key policy grants the Lambda execution role Encrypt/Decrypt on this key
  # only. The role ARN is computed (local.lambda_role_arn) to avoid a cycle
  # with the lambda module.
  key_statements = [
    {
      sid    = "AllowLambdaEncryptDecrypt"
      effect = "Allow"
      actions = [
        "kms:Encrypt",
        "kms:Decrypt",
      ]
      resources = ["*"]
      principals = [
        {
          type        = "AWS"
          identifiers = [local.lambda_role_arn]
        }
      ]
    }
  ]
}

# --- Secrets Manager (value added out of band, see DEPLOY.aws.md) -----------

# One JSON secret: {"client_id":"...","client_secret":"..."}. Created WITHOUT a
# version; the operator adds the JSON value out of band before the Lambda runs.
module "secret" {
  source  = "terraform-aws-modules/secrets-manager/aws"
  version = "2.2.0"

  name        = "${local.name}-google-oauth"
  description = "Google OAuth client for ${local.name}: JSON { client_id, client_secret }."

  create_secret_version = false
}

# --- Lambda ------------------------------------------------------------------

module "lambda" {
  source  = "terraform-aws-modules/lambda/aws"
  version = "8.13.0"

  function_name = local.name
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  timeout       = 30
  memory_size   = 512

  # Code is built and deployed out of band (npm run build:lambda +
  # aws lambda update-function-code / CI); Terraform uses the prebuilt zip for
  # the initial create and then ignores later code changes.
  create_package          = false
  local_existing_package  = var.lambda_zip_path
  ignore_source_code_hash = true

  environment_variables = local.lambda_environment

  # Fixed role name so the KMS key policy can reference it (local.lambda_role_arn).
  role_name = local.lambda_role_name

  # Least-privilege runtime policy: DynamoDB item ops + Query on the table and
  # its indexes, KMS Encrypt/Decrypt on the one key, GetSecretValue on the one
  # secret. CloudWatch Logs is attached by default (attach_cloudwatch_logs_policy).
  attach_policy_statements = true
  policy_statements = {
    dynamodb = {
      effect = "Allow"
      actions = [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
      ]
      resources = [
        module.dynamodb.dynamodb_table_arn,
        "${module.dynamodb.dynamodb_table_arn}/index/*",
      ]
    }
    kms = {
      effect    = "Allow"
      actions   = ["kms:Encrypt", "kms:Decrypt"]
      resources = [module.kms.key_arn]
    }
    secrets = {
      effect    = "Allow"
      actions   = ["secretsmanager:GetSecretValue"]
      resources = [module.secret.secret_arn]
    }
  }

  # Let API Gateway invoke the function.
  allowed_triggers = {
    APIGateway = {
      service    = "apigateway"
      source_arn = "${module.apigateway.api_execution_arn}/*/*"
    }
  }
}

# --- API Gateway HTTP API ----------------------------------------------------

module "apigateway" {
  source  = "terraform-aws-modules/apigateway-v2/aws"
  version = "6.1.1"

  name          = local.name
  protocol_type = "HTTP"

  # The module can create its own ACM cert and Route 53 records, but the acm
  # module owns the certificate here and the alias record is created below, so
  # both are disabled.
  create_certificate    = false
  create_domain_records = false
  create_domain_name    = var.enable_custom_domain

  domain_name                 = var.enable_custom_domain ? var.custom_domain : ""
  domain_name_certificate_arn = var.enable_custom_domain ? module.acm.acm_certificate_arn : null

  # $default route proxies everything to the Lambda (payload format 2.0). The
  # module creates the integration, route and $default auto-deploy stage.
  routes = {
    "$default" = {
      integration = {
        uri                    = module.lambda.lambda_function_arn
        type                   = "AWS_PROXY"
        payload_format_version = "2.0"
      }
    }
  }
}

# --- Custom domain (stable hostname for the OAuth issuer/redirect) ----------

# The custom domain gives a stable hostname from day one, so the issuer and
# redirect URI baked into every connector never have to change. When
# route53_zone_id is set (zone in this account), the acm module writes the DNS
# validation records and waits for ISSUED, and the alias record below points
# custom_domain at the API Gateway domain target -- a single apply, no manual
# DNS. When it is empty, the cert is created but not validated here; create the
# records from the acm_validation_records / custom_domain_target outputs.
module "acm" {
  source  = "terraform-aws-modules/acm/aws"
  version = "6.3.1"

  create_certificate = var.enable_custom_domain

  domain_name       = var.custom_domain
  zone_id           = var.route53_zone_id
  validation_method = "DNS"

  create_route53_records = local.route53_managed
  validate_certificate   = local.route53_managed
  wait_for_validation    = local.route53_managed
}

# Alias record pointing custom_domain at the API Gateway v2 regional domain.
# Only created when the zone is in this account (route53_managed).
resource "aws_route53_record" "custom_alias" {
  for_each = local.route53_managed ? toset(["A", "AAAA"]) : toset([])

  zone_id = var.route53_zone_id
  name    = var.custom_domain
  type    = each.value

  alias {
    name                   = module.apigateway.domain_name_target_domain_name
    zone_id                = module.apigateway.domain_name_hosted_zone_id
    evaluate_target_health = false
  }
}
