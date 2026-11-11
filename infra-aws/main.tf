locals {
  name = var.service_name
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# --- DynamoDB: single-table store -------------------------------------------

# pk (partition) + sk (sort), both strings; numeric `ttl` attribute (epoch
# seconds) drives DynamoDB TTL. The server checks `expiresAt` (epoch ms) on
# every read, so DynamoDB TTL is garbage collection only.
resource "aws_dynamodb_table" "store" {
  name         = local.name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true
  }
}

# --- KMS: per-token encryption ----------------------------------------------

resource "aws_kms_key" "tokens" {
  description             = "${local.name} token encryption (per-token KMS Encrypt/Decrypt)"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

resource "aws_kms_alias" "tokens" {
  name          = "alias/${local.name}-tokens"
  target_key_id = aws_kms_key.tokens.key_id
}

# --- Secrets Manager (value added out of band, see DEPLOY.aws.md) -----------

# One JSON secret: {"client_id":"...","client_secret":"..."}. Created empty;
# the operator adds the version out of band before the Lambda runs.
resource "aws_secretsmanager_secret" "google_oauth" {
  name        = "${local.name}-google-oauth"
  description = "Google OAuth client for ${local.name}: JSON { client_id, client_secret }."
}

# --- IAM: least-privilege Lambda execution role -----------------------------

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda" {
  name               = "${local.name}-lambda"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

# CloudWatch Logs.
resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "lambda_runtime" {
  statement {
    sid    = "DynamoDb"
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
    ]
    resources = [
      aws_dynamodb_table.store.arn,
      "${aws_dynamodb_table.store.arn}/index/*",
    ]
  }

  statement {
    sid    = "Kms"
    effect = "Allow"
    actions = [
      "kms:Encrypt",
      "kms:Decrypt",
    ]
    resources = [aws_kms_key.tokens.arn]
  }

  statement {
    sid       = "SecretsManager"
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.google_oauth.arn]
  }
}

resource "aws_iam_role_policy" "lambda_runtime" {
  name   = "${local.name}-runtime"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda_runtime.json
}

# --- Lambda ------------------------------------------------------------------

resource "aws_lambda_function" "server" {
  function_name = local.name
  role          = aws_iam_role.lambda.arn
  runtime       = "nodejs22.x"
  handler       = "index.handler"
  filename      = var.lambda_zip_path
  timeout       = 30
  memory_size   = 512

  environment {
    variables = merge({
      GOOGLE_REDIRECT_URI    = "${var.issuer_url}/callback"
      ISSUER_URL             = var.issuer_url
      STORAGE                = "dynamodb"
      DYNAMODB_TABLE         = aws_dynamodb_table.store.name
      CIPHER                 = "awskms"
      AWS_KMS_KEY_ID         = aws_kms_key.tokens.arn
      GOOGLE_OAUTH_SECRET_ID = aws_secretsmanager_secret.google_oauth.arn
      ALLOWED_DOMAIN         = var.allowed_domain
      ALLOWED_REDIRECT_URIS  = join(",", var.allowed_redirect_uris)
      TRUST_PROXY_HOPS       = "1"
      PUBLIC_PAGES           = var.public_pages
      ANALYTICS              = "false" # never report a shared server's visitors to upstream's analytics
      LOG_LEVEL              = "info"
    }, var.privacy_policy_url == "" ? {} : { PRIVACY_POLICY_URL = var.privacy_policy_url })
  }

  lifecycle {
    # Code is deployed out of band (npm run build:lambda + aws lambda update-function-code / CI).
    ignore_changes = [filename, source_code_hash]
  }

  depends_on = [
    aws_iam_role_policy.lambda_runtime,
    aws_iam_role_policy_attachment.lambda_basic,
  ]
}

# --- API Gateway HTTP API ----------------------------------------------------

resource "aws_apigatewayv2_api" "http" {
  name          = local.name
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.server.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "default" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowApiGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.server.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}

# --- Custom domain (stable hostname for the OAuth issuer/redirect) ----------

# The custom domain gives a stable hostname from day one, so the issuer and
# redirect URI baked into every connector never have to change.
resource "aws_acm_certificate" "custom" {
  count             = var.enable_custom_domain ? 1 : 0
  domain_name       = var.custom_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_apigatewayv2_domain_name" "custom" {
  count       = var.enable_custom_domain ? 1 : 0
  domain_name = var.custom_domain

  domain_name_configuration {
    certificate_arn = aws_acm_certificate.custom[0].arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }
}

resource "aws_apigatewayv2_api_mapping" "custom" {
  count       = var.enable_custom_domain ? 1 : 0
  api_id      = aws_apigatewayv2_api.http.id
  domain_name = aws_apigatewayv2_domain_name.custom[0].id
  stage       = aws_apigatewayv2_stage.default.id
}
