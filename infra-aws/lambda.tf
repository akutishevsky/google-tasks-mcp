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
