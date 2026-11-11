output "api_endpoint" {
  description = "API Gateway HTTP API invoke URL ($default stage)."
  value       = module.apigateway.stage_invoke_url
}

output "custom_domain_target" {
  description = "Fallback for a zone NOT in this account: point the custom hostname (alias/CNAME) at this API Gateway target domain and hosted zone. Not needed when route53_zone_id is set (Terraform creates the alias record)."
  value = var.enable_custom_domain ? {
    target_domain_name = module.apigateway.domain_name_target_domain_name
    hosted_zone_id     = module.apigateway.domain_name_hosted_zone_id
  } : null
}

output "acm_validation_records" {
  description = "Fallback for a zone NOT in this account: DNS validation records to create so ACM can validate the certificate. Empty when route53_zone_id is set (the acm module creates them)."
  value = var.enable_custom_domain && var.route53_zone_id == "" ? [
    for o in module.acm.acm_certificate_domain_validation_options : {
      name  = o.resource_record_name
      type  = o.resource_record_type
      value = o.resource_record_value
    }
  ] : []
}

output "dynamodb_table" {
  description = "Value for DYNAMODB_TABLE."
  value       = module.dynamodb.dynamodb_table_id
}

output "kms_key_arn" {
  description = "Value for AWS_KMS_KEY_ID (also used by npm run revoke)."
  value       = module.kms.key_arn
}

output "secret_arn" {
  description = "Value for GOOGLE_OAUTH_SECRET_ID; add the JSON version out of band."
  value       = module.secret.secret_arn
}

output "lambda_function_name" {
  description = "Lambda function name for aws lambda update-function-code."
  value       = module.lambda.lambda_function_name
}

output "lambda_version" {
  description = "Version of the committed Lambda deployment package (matches the lambda-version tag)."
  value       = var.lambda_version
}
