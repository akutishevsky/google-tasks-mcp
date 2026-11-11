# --- ACM certificate + custom domain DNS ------------------------------------

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
