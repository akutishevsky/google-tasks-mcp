# `infra-aws/` — Terraform for the AWS deployment

Terraform for the "AWS option" of google-tasks-mcp (Lambda + API Gateway HTTP
API + DynamoDB + KMS + Secrets Manager). See the full design in
[`../docs/specs/2026-10-23-aws-deployment-design.md`](../docs/specs/2026-10-23-aws-deployment-design.md)
and the runbook in [`../DEPLOY.aws.md`](../DEPLOY.aws.md).

## Layout: thin root + reusable child module

The code is split into a **hybrid layout**:

- **`infra-aws/`** — the thin root. It holds the Terraform **backend** (`backend
  "s3" {}`) and the AWS **provider** (`versions.tf`), passes every input through
  to the child module (`main.tf`), and re-exposes the child's outputs
  (`outputs.tf`). This is what you deploy directly.
- **`infra-aws/modules/google-tasks-mcp/`** — the **reusable child module**. It
  holds all the resource logic (`dynamodb.tf`, `kms.tf`, `secrets.tf`,
  `lambda.tf`, `apigateway.tf`, `dns.tf`), the shared locals and data sources
  (`main.tf`), the full `variables.tf`/`outputs.tf`, and a `versions.tf` that
  declares **only `required_providers`** — no backend, no provider block, so it
  can be consumed from any root.

Each service family uses one official `terraform-aws-modules/*` registry module,
pinned: `dynamodb-table`, `kms`, `secrets-manager`, `lambda`, `apigateway-v2`
and `acm`, plus one bare `aws_route53_record` alias in `dns.tf`.

## Standalone use (deploy this root)

```bash
cd infra-aws
cp terraform.tfvars.example terraform.tfvars   # fill in your values
cp backend.hcl.example backend.hcl             # fill in your S3 + lock table
terraform init -backend-config=backend.hcl
terraform apply -var-file=terraform.tfvars
```

`terraform init` downloads the pinned registry modules and the child module.
`terraform.tfvars`, `backend.hcl` and any `client_secret_*.json` are gitignored —
keep your real values out of the repo. The two-phase first apply (create the
secret before the Lambda that reads it) and the OAuth client one-off are in
[`../DEPLOY.aws.md`](../DEPLOY.aws.md).

## Remote use (reference the child module from your own root)

The child module can be referenced directly from another Terraform project with
a Git source and a pinned `?ref=` (a tag, branch or commit). **The caller
supplies its own backend and provider** — the child declares neither:

```hcl
module "google_tasks_mcp" {
  source = "github.com/franc-liuzzi/google-tasks-mcp//infra-aws/modules/google-tasks-mcp?ref=<ref>"

  region        = "eu-west-1"   # provider config stays in YOUR root
  issuer_url    = "https://tasks.example.com"
  # ... the remaining inputs (see variables.tf)
}
```

Note the `//` before the subdirectory and the `?ref=<ref>` pin. The child module
has no `region` input — the AWS region comes from the **provider** you configure
in your own root, along with your own `backend` block.

## Lambda package: the committed zip

The Lambda code is a **prebuilt, committed artifact**: the zip is not built by
Terraform at apply time. The default package is **`infra-aws/src/lambda.zip`**,
tracked in the repo. The module sets `create_package = false` and
`local_existing_package` to that zip, and ignores later source-code-hash changes
(code is deployed out of band with `aws lambda update-function-code`).

- **`lambda_zip_path`** (default `null`) — when left null, the module resolves
  the committed artifact at `path.module/../../src/lambda.zip` (that is,
  `infra-aws/src/lambda.zip`). Override it to point at a different zip.
- **`lambda_version`** (default `1.0.0`, the `package.json` version) — recorded
  as the `lambda-version` resource tag on the Lambda and re-exposed as the
  `lambda_version` **output**, so a deployed function can be traced back to the
  build it came from.

## Build before every push (enforced by a pre-push hook)

Whoever commits, pushes and tags is responsible for rebuilding the committed zip
first — the build is **not** delegated to whoever applies the module. Before
every push that touches `src/`:

```bash
npm run build:lambda:zip   # builds the bundle and writes infra-aws/src/lambda.zip
git add infra-aws/src/lambda.zip
```

A `pre-push` hook in [`../.githooks/pre-push`](../.githooks/pre-push) enforces
this: if the push range touches `src/`, it rebuilds the bundle and blocks the
push when `infra-aws/src/lambda.zip` is stale or missing. Enable the hooks once
per clone:

```bash
git config core.hooksPath .githooks
```
