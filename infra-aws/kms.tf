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
