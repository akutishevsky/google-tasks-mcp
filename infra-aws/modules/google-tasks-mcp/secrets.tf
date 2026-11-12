# --- Secrets Manager (value added out of band, see DEPLOY.aws.md) -----------

# One JSON secret: {"client_id":"...","client_secret":"..."}. Created WITHOUT a
# version; the operator adds the JSON value out of band before the Lambda runs.
module "secret" {
  source  = "terraform-aws-modules/secrets-manager/aws"
  version = "2.2.0"

  name        = "${local.name}-google-oauth"
  description = "Google OAuth client for ${local.name}: JSON { client_id, client_secret }."

  create_secret_version = false
}
