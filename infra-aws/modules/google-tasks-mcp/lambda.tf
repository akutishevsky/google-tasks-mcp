# --- Lambda ------------------------------------------------------------------

module "lambda" {
  source  = "terraform-aws-modules/lambda/aws"
  version = "8.13.0"

  function_name = local.name
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  timeout       = 30
  memory_size   = 512

  # Code is built out of band (npm run build:lambda:zip) into the committed
  # artifact. Terraform tracks that zip: when its source_code_hash changes, a
  # terraform apply updates the function code. Rebuild and commit the zip, then
  # apply, to deploy a new version.
  create_package         = false
  local_existing_package = local.lambda_zip_path

  environment_variables = local.lambda_environment

  tags = { "lambda-version" = var.lambda_version }

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

  # Let API Gateway invoke the function. The permission targets the unversioned
  # function: we do not publish versions (publish = false), so pinning the
  # trigger to a published version would point at $LATEST, which AWS rejects
  # ("We currently do not support adding policies for $LATEST").
  create_current_version_allowed_triggers = false
  allowed_triggers = {
    APIGateway = {
      service    = "apigateway"
      source_arn = "${module.apigateway.api_execution_arn}/*/*"
    }
  }
}
