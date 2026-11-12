variable "service_name" {
  description = "Lambda function name; also prefixes other resources."
  type        = string
  default     = "google-tasks-mcp"
}

variable "issuer_url" {
  description = "Public base URL of the server, e.g. https://<host>. Pins the OAuth issuer and Google redirect URI."
  type        = string
}

variable "allowed_domain" {
  description = "Google Workspace domain allowed to sign in. Empty allows any Google account."
  type        = string
  default     = ""
}

variable "allowed_redirect_uris" {
  description = "OAuth redirect URIs clients may register: exact https URIs, or \"loopback\" for local clients (Claude Code, mcp-remote). Stops a crafted login link from sending a user's code to another site."
  type        = list(string)
  default     = ["loopback", "https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"]
}

variable "public_pages" {
  description = "\"auto\": landing page for browsers, JSON for everything else; \"false\": JSON only; \"true\": HTML always."
  type        = string
  default     = "auto"
  validation {
    condition     = contains(["auto", "true", "false"], var.public_pages)
    error_message = "public_pages must be \"auto\", \"true\" or \"false\"."
  }
}

variable "privacy_policy_url" {
  description = "Your organisation's privacy policy; /privacy-policy redirects there. Leave empty to serve the bundled page, which describes the upstream project's hosted service."
  type        = string
  default     = ""
}

variable "custom_domain" {
  description = "Hostname to map to the API Gateway HTTP API (requires an ACM certificate, created here)."
  type        = string
  default     = ""
}

variable "enable_custom_domain" {
  description = "Create the ACM certificate and API Gateway v2 custom domain for custom_domain."
  type        = bool
  default     = false
}

variable "route53_zone_id" {
  description = "Route 53 hosted zone ID for custom_domain, when the zone lives in this account. Set it and Terraform owns the whole DNS flow: the ACM module writes the validation records and waits for ISSUED, and the alias record for custom_domain is created pointing at the API Gateway. Leave empty when the zone is elsewhere; then create the acm_validation_records and custom_domain_target records by hand."
  type        = string
  default     = ""
}

variable "lambda_zip_path" {
  description = "Path to the built Lambda deployment package (zip of build/lambda/). Terraform tracks the zip's source_code_hash and updates the function code on apply when it changes. Null (the default) resolves to the committed artifact at path.module/../../src/lambda.zip (infra-aws/src/lambda.zip)."
  type        = string
  default     = null
}

variable "lambda_version" {
  description = "Version of the committed Lambda deployment package (package.json version). Applied as the lambda-version resource tag and exposed as an output so a deploy can be traced back to a build."
  type        = string
  default     = "1.0.0"
}
