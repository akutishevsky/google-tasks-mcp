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
- For a custom hostname: a Route 53 hosted zone. If the zone is in this account,
  set `route53_zone_id` and Terraform owns the whole DNS flow (validation records,
  the ISSUED wait and the alias record) — no manual steps. If the zone is elsewhere,
  you create the ACM validation and custom-domain records by hand from the outputs.

## 1. Infrastructure

```bash
cd infra-aws
cp terraform.tfvars.example terraform.tfvars   # fill in
cp backend.hcl.example backend.hcl             # fill in
terraform init -backend-config=backend.hcl
# First run: create the secret before the Lambda that reads it.
terraform apply -var-file=terraform.tfvars -target=module.secret
```

Now add the OAuth client credentials (step 2), then come back and apply the rest:

```bash
terraform plan -var-file=terraform.tfvars
terraform apply -var-file=terraform.tfvars
```

The Lambda fetches the secret at cold start, so creating the secret first keeps
the two-phase apply clean.

`infra-aws/` is a thin root (backend + provider) that calls the reusable child
module at `infra-aws/modules/google-tasks-mcp/`, where all the resource logic
lives. The init/apply commands above are unchanged by this layout — see
[`infra-aws/README.md`](infra-aws/README.md) for the root-vs-child split and for
referencing the child module remotely. The default Lambda package is the
committed artifact `infra-aws/src/lambda.zip` (the module resolves it when
`lambda_zip_path` is left null); rebuilding it before every push is covered in
§3.

`infra-aws/` is built from the official `terraform-aws-modules/*` registry modules
(pinned): `dynamodb-table`, `kms`, `secrets-manager`, `lambda`, `apigateway-v2`
and `acm`. `terraform init` downloads them. Together they create: the DynamoDB
table (single table, TTL on `ttl`, point-in-time recovery), the KMS key + alias
(`alias/<service>-tokens`, rotation on, key policy granting the Lambda role
Encrypt/Decrypt), the empty Secrets Manager secret (no version — added out of
band), the least-privilege Lambda execution role + function (placeholder code),
the API Gateway HTTP API with the `$default` route, `$default` stage and invoke
permission, and — behind `enable_custom_domain` — the ACM certificate and API
Gateway custom domain + mapping. When `route53_zone_id` is set, it also writes
the ACM DNS validation records, waits for ISSUED, and creates the alias record
for the hostname, so one `terraform apply` needs no manual DNS.

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

> **Build before every push.** The committed `infra-aws/src/lambda.zip` is the
> default package Terraform deploys, so it must be rebuilt and copied into place
> before every push or tag that changes `src/`. The build is the responsibility
> of whoever pushes — it is never delegated to whoever applies the module.

```bash
npm run build:lambda
(cd build/lambda && zip -r ../lambda.zip .)
cp build/lambda.zip infra-aws/src/lambda.zip
git add infra-aws/src/lambda.zip
```

A `pre-push` hook ([`.githooks/pre-push`](.githooks/pre-push)) enforces this: if
the push range touches `src/`, it rebuilds the bundle and blocks the push when
`infra-aws/src/lambda.zip` is stale or missing. Enable it once per clone:

```bash
git config core.hooksPath .githooks
```

The bundle marks `@aws-sdk/*`, `@deno/kv` and `@google-cloud/*` as external:
the AWS SDK v3 is provided by the `nodejs22.x` runtime, and the other two are
only ever loaded by a backend the AWS deployment does not use (`denokv` /
`firestore` / `gcpkms`). Every backend is imported lazily (`await import`) when
its `STORAGE`/`CIPHER` is selected, so with `STORAGE=dynamodb` and
`CIPHER=awskms` none of those packages is loaded at all. This matters for
`@deno/kv` in particular: it ships a native `.node` binding that cannot be
bundled, so it must stay external and lazy — otherwise the function crashes at
cold start with `ERR_MODULE_NOT_FOUND`.

## 4. Custom hostname

Set `enable_custom_domain = true`. Use the custom hostname from day one: the
issuer and redirect URI are baked into every connector, and changing them forces
everyone to reconnect.

**Zone in this account (recommended):** set `route53_zone_id` to the hosted zone
ID. One `terraform apply` creates the ACM certificate, writes the DNS validation
records in that zone, waits for the cert to be ISSUED, creates the API Gateway
custom domain + mapping, and adds the alias `A`/`AAAA` record for the hostname —
no manual DNS. (Validation can still take a few minutes while the apply waits.)

**Zone in another account (fallback):** leave `route53_zone_id = ""`. The cert is
created but not validated by Terraform; create the records by hand:

```bash
terraform -chdir=infra-aws output acm_validation_records   # create these records at your DNS provider first
terraform -chdir=infra-aws output custom_domain_target     # point <host> at target_domain_name
```

Create the ACM validation record(s) first; certificate validation and the custom
domain can take a while.

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
