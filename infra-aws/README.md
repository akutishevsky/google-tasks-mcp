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
  source = "github.com/akutishevsky/google-tasks-mcp//infra-aws/modules/google-tasks-mcp?ref=<ref>"

  region        = "eu-west-1"   # provider config stays in YOUR root
  issuer_url    = "https://tasks.example.com"
  # ... the remaining inputs (see variables.tf)
}
```

Note the `//` before the subdirectory and the `?ref=<ref>` pin. The child module
has no `region` input — the AWS region comes from the **provider** you configure
in your own root, along with your own `backend` block.

## Lambda package

The Lambda code is not committed and Terraform does not build it. Build it
first with `npm run build:lambda:zip`, which writes **`build/lambda.zip`**
(`build/` is gitignored). The module sets `create_package = false` and
`local_existing_package` to that zip, and tracks its `source_code_hash`: when
the zip changes, `terraform apply` updates the function code. To deploy a new
version, pull, rebuild the zip, then apply.

- **`lambda_zip_path`** (default `null`) — when left null, the module resolves
  `build/lambda.zip` at the repo root (`path.module/../../../build/lambda.zip`).
  A project that references the child module remotely must set it to a zip it
  built from a checkout of this repo.
- **`lambda_version`** — when deploying the root, it defaults to the `version`
  read from the repo-root `package.json` (no manual step); override it with an
  explicit value (e.g. a CI `git describe`). The child module, used
  remotely without the repo root, keeps a static `1.0.0` default. Recorded as
  the `lambda-version` resource tag on the Lambda and re-exposed as the
  `lambda_version` **output**, so a deployed function can be traced back to the
  build it came from.
