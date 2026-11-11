output "api_endpoint" {
  description = "API Gateway HTTP API invoke URL ($default stage)."
  value       = module.google-tasks-mcp.api_endpoint
}

output "custom_domain_target" {
  description = "Fallback for a zone NOT in this account: point the custom hostname (alias/CNAME) at this API Gateway target domain and hosted zone. Not needed when route53_zone_id is set (Terraform creates the alias record)."
  value       = module.google-tasks-mcp.custom_domain_target
}

output "acm_validation_records" {
  description = "Fallback for a zone NOT in this account: DNS validation records to create so ACM can validate the certificate. Empty when route53_zone_id is set (the acm module creates them)."
  value       = module.google-tasks-mcp.acm_validation_records
}

output "dynamodb_table" {
  description = "Value for DYNAMODB_TABLE."
  value       = module.google-tasks-mcp.dynamodb_table
}

output "kms_key_arn" {
  description = "Value for AWS_KMS_KEY_ID (also used by npm run revoke)."
  value       = module.google-tasks-mcp.kms_key_arn
}

output "secret_arn" {
  description = "Value for GOOGLE_OAUTH_SECRET_ID; add the JSON version out of band."
  value       = module.google-tasks-mcp.secret_arn
}

output "lambda_function_name" {
  description = "Lambda function name for aws lambda update-function-code."
  value       = module.google-tasks-mcp.lambda_function_name
}

output "lambda_version" {
  description = "Version of the committed Lambda deployment package (matches the lambda-version tag)."
  value       = module.google-tasks-mcp.lambda_version
}
