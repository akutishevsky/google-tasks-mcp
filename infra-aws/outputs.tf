output "api_endpoint" {
  description = "API Gateway HTTP API invoke URL ($default stage)."
  value       = aws_apigatewayv2_stage.default.invoke_url
}

output "custom_domain_target" {
  description = "Point the custom hostname (CNAME/alias) at this API Gateway target domain and hosted zone."
  value = var.enable_custom_domain ? {
    target_domain_name = aws_apigatewayv2_domain_name.custom[0].domain_name_configuration[0].target_domain_name
    hosted_zone_id     = aws_apigatewayv2_domain_name.custom[0].domain_name_configuration[0].hosted_zone_id
  } : null
}

output "acm_validation_records" {
  description = "DNS CNAME records to create so ACM can validate the certificate."
  value = var.enable_custom_domain ? [
    for o in aws_acm_certificate.custom[0].domain_validation_options : {
      name  = o.resource_record_name
      type  = o.resource_record_type
      value = o.resource_record_value
    }
  ] : []
}

output "dynamodb_table" {
  description = "Value for DYNAMODB_TABLE."
  value       = aws_dynamodb_table.store.name
}

output "kms_key_arn" {
  description = "Value for AWS_KMS_KEY_ID (also used by npm run revoke)."
  value       = aws_kms_key.tokens.arn
}

output "secret_arn" {
  description = "Value for GOOGLE_OAUTH_SECRET_ID; add the JSON version out of band."
  value       = aws_secretsmanager_secret.google_oauth.arn
}

output "lambda_function_name" {
  description = "Lambda function name for aws lambda update-function-code."
  value       = aws_lambda_function.server.function_name
}
