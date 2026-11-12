# --- API Gateway HTTP API ----------------------------------------------------

module "apigateway" {
  source  = "terraform-aws-modules/apigateway-v2/aws"
  version = "6.1.1"

  name          = local.name
  protocol_type = "HTTP"

  # The module can create its own ACM cert and Route 53 records, but the acm
  # module owns the certificate here and the alias record is created in dns.tf,
  # so both are disabled.
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
