# Deploying to AWS (Lambda + API Gateway + DynamoDB + KMS)

This is the "AWS option": a shared, multi-user server where each person signs in
with their own Google account. The app runs on Lambda (Node 22) behind an API
Gateway HTTP API, state lives in DynamoDB, Google tokens are encrypted with AWS
KMS, and the function scales to zero. Design:
[`docs/specs/2026-10-23-aws-deployment-design.md`](docs/specs/2026-10-23-aws-deployment-design.md).

Placeholders: `<region>`, `<domain>` (Workspace domain), `<host>` (public
hostname), `<state-bucket>`, `<lock-table>`. Keep your real values in untracked
files (`infra-aws/terraform.tfvars`, `infra-aws/backend.hcl`) or in a private repo.

## Prerequisites

- AWS CLI authenticated with permission to create DynamoDB, KMS, Secrets Manager,
  IAM, Lambda and API Gateway resources; `terraform` ≥ 1.6; Node 22.
- An S3 bucket for Terraform state and a DynamoDB table for the state lock.
- For a custom hostname: access to the domain's DNS to create the ACM validation
  and custom-domain records.

## 1. Infrastructure

```bash
cd infra-aws
cp terraform.tfvars.example terraform.tfvars   # fill in
cp backend.hcl.example backend.hcl             # fill in
terraform init -backend-config=backend.hcl
# First run: create the secret before the Lambda that reads it.
terraform apply -var-file=terraform.tfvars -target=aws_secretsmanager_secret.google_oauth
```

Now add the OAuth client credentials (step 2), then come back and apply the rest:

```bash
terraform plan -var-file=terraform.tfvars
terraform apply -var-file=terraform.tfvars
```

The Lambda fetches the secret at cold start, so creating the secret first keeps
the two-phase apply clean.

Creates: the DynamoDB table (single table, TTL on `ttl`, point-in-time recovery),
the KMS key + alias (`alias/<service>-tokens`, rotation on), the empty Secrets
Manager secret, the least-privilege Lambda execution role, the Lambda function
(placeholder code), the API Gateway HTTP API with the `$default` route + invoke
permission, and optionally the ACM certificate and API Gateway custom domain.

## 2. OAuth client (console, one-off; before the full apply)

1. **Google Auth Platform → Branding/Audience**: set the consent screen to
   **Internal** (Workspace users only; avoids Google verification for the
   sensitive Tasks scope).
2. **Data access**: scopes `openid`, `email`, `https://www.googleapis.com/auth/tasks`.
3. **Clients → Create client → Web application**. Authorized redirect URI:
   `https://<host>/callback`.
4. Store the credentials as one JSON secret (keys `client_id`, `client_secret`):

```bash
SECRET=$(terraform -chdir=infra-aws output -raw secret_arn)
aws secretsmanager put-secret-value --secret-id "$SECRET" \
  --secret-string '{"client_id":"<client-id>","client_secret":"<client-secret>"}'
```

## 3. Build and deploy the Lambda

```bash
npm ci
npm run build:lambda                 # bundles build/lambda/index.mjs with esbuild
(cd build/lambda && zip -r ../lambda.zip .)   # zip the directory contents (index.mjs at the root)
FN=$(terraform -chdir=infra-aws output -raw lambda_function_name)
aws lambda update-function-code --function-name "$FN" --zip-file fileb://build/lambda.zip
```

Terraform ignores the function code after creation, so `aws lambda
update-function-code` (or CI) owns rollouts. The handler is `index.handler`.

## 4. Custom hostname

Set `enable_custom_domain = true`, apply, then:

```bash
terraform -chdir=infra-aws output acm_validation_records   # create these CNAMEs at your DNS provider
terraform -chdir=infra-aws output custom_domain_target     # point <host> at target_domain_name
```

Create the ACM validation CNAME(s) first; certificate validation and the custom
domain can take a while. Use the custom hostname from day one: the issuer and
redirect URI are baked into every connector, and changing them forces everyone to
reconnect.

## 5. Checks (no browser)

```bash
BASE=https://<host>
curl -s $BASE/health                                        # {"status":"ok"}
curl -s $BASE/.well-known/oauth-authorization-server        # issuer = $BASE
curl -s $BASE/.well-known/oauth-protected-resource/mcp      # resource = $BASE/mcp
curl -si -X POST $BASE/mcp | grep -i www-authenticate       # 401 + resource_metadata
```

## 6. Connect

Add `https://<host>/mcp` as a custom connector (Claude web/Desktop: Settings →
Connectors; Claude Code: `claude mcp add --transport http google-tasks https://<host>/mcp`;
other clients: `npx mcp-remote https://<host>/mcp`). Sign in with a `@<domain>`
account; other accounts get 403.
