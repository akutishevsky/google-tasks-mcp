# Thin root: the backend and provider live here (versions.tf); all resource
# logic lives in the reusable child module, which this calls with every input
# and whose outputs are re-exposed in outputs.tf.

locals {
  # lambda_version defaults to the version in the repo-root package.json, so the
  # lambda-version tag/output tracks the released version with no manual step.
  # An explicit var.lambda_version (e.g. a CI-supplied git describe) overrides it.
  package_version = jsondecode(file("${path.module}/../package.json")).version
  lambda_version  = coalesce(var.lambda_version, local.package_version)
}

module "google-tasks-mcp" {
  source = "./modules/google-tasks-mcp"

  service_name          = var.service_name
  issuer_url            = var.issuer_url
  allowed_domain        = var.allowed_domain
  allowed_redirect_uris = var.allowed_redirect_uris
  public_pages          = var.public_pages
  privacy_policy_url    = var.privacy_policy_url
  custom_domain         = var.custom_domain
  enable_custom_domain  = var.enable_custom_domain
  route53_zone_id       = var.route53_zone_id
  lambda_zip_path       = var.lambda_zip_path
  lambda_version        = local.lambda_version
}
