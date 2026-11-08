# Deploying to Google Cloud (Cloud Run + Firestore + KMS)

This is the "gcloud option": a shared, multi-user server where each person signs
in with their own Google account. State lives in Firestore, Google tokens are
encrypted with Cloud KMS, and the service scales to zero. Design:
[`docs/specs/2026-10-17-gcp-deployment-design.md`](docs/specs/2026-10-17-gcp-deployment-design.md).

Placeholders: `<project>`, `<region>`, `<domain>` (Workspace domain), `<host>`
(public hostname), `<state-bucket>`. Keep your real values in untracked files
(`infra/terraform.tfvars`, `infra/backend.hcl`) or in a private repo.

## Prerequisites

- `gcloud` authenticated as a project owner/editor, `terraform` ≥ 1.6, Docker.
- A GCS bucket for Terraform state.
- For a custom hostname: the domain verified for the project (Search Console)
  and access to its DNS.

## 1. Infrastructure

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars   # fill in
cp backend.hcl.example backend.hcl             # fill in
terraform init -backend-config=backend.hcl
# First run: create the secrets before the service that reads them.
terraform apply -var-file=terraform.tfvars -target=google_secret_manager_secret.google_oauth
```

Now add the OAuth client credentials (step 2), then come back and apply the rest:

```bash
terraform plan -var-file=terraform.tfvars
terraform apply -var-file=terraform.tfvars
```

Cloud Run resolves the secrets at version `latest` when the first revision
starts, so the full apply fails if the secrets have no versions yet.

Creates: APIs, Artifact Registry, runtime and deployer service accounts,
Firestore database with TTL policies, KMS key ring and key (90-day rotation),
Secret Manager secrets (empty), Cloud Run service (placeholder image),
public invoker binding, and optionally the domain mapping.

## 2. OAuth client (console, one-off; before the full apply)

1. **Google Auth Platform → Branding/Audience**: set the consent screen to
   **Internal** (Workspace users only; avoids Google verification for the
   sensitive Tasks scope).
2. **Data access**: scopes `openid`, `email`, `https://www.googleapis.com/auth/tasks`.
3. **Clients → Create client → Web application**. Authorized redirect URI:
   `https://<host>/callback`.
4. Store the credentials:

```bash
printf '%s' '<client-id>'     | gcloud secrets versions add gtasks-mcp-google-client-id --data-file=- --project <project>
printf '%s' '<client-secret>' | gcloud secrets versions add gtasks-mcp-google-client-secret --data-file=- --project <project>
```

## 3. Build and deploy

```bash
REPO=$(terraform -chdir=infra output -raw artifact_registry)
TAG=$(git rev-parse --short HEAD)
gcloud auth configure-docker <region>-docker.pkg.dev
docker build -t "$REPO/google-tasks-mcp:$TAG" .
docker push "$REPO/google-tasks-mcp:$TAG"
gcloud run deploy google-tasks-mcp --image "$REPO/google-tasks-mcp:$TAG" --region <region> --project <project>
```

Terraform ignores the image after creation, so `gcloud run deploy` (or CI using
the deployer service account) owns rollouts.

## 4. Custom hostname

Set `enable_custom_domain = true`, apply, then create the records from
`terraform output domain_dns_records` at your DNS provider. Certificate
provisioning can take up to an hour. Use the custom hostname from day one:
the issuer and redirect URI are baked into every connector, and changing them
forces everyone to reconnect.

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
