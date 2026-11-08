locals {
  name               = var.service_name
  firestore_location = coalesce(var.firestore_location, var.region)
  # Every collection the server writes with an expiry (see test/support/store-dump.ts).
  ttl_collections = ["grants", "access", "refresh", "refresh_used", "grants_by_email", "revoked", "oauth_sessions", "auth_codes", "rate_limit"]
}

resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "firestore.googleapis.com",
    "cloudkms.googleapis.com",
    "secretmanager.googleapis.com",
    "tasks.googleapis.com",
  ])
  service            = each.value
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "repo" {
  location      = var.region
  repository_id = "${local.name}-repo"
  format        = "DOCKER"
  depends_on    = [google_project_service.apis]
}

# --- Identities -------------------------------------------------------------

resource "google_service_account" "runtime" {
  account_id   = "gtasks-mcp-sa"
  display_name = "${local.name} runtime"
}

resource "google_service_account" "deployer" {
  account_id   = "gtasks-mcp-deployer"
  display_name = "${local.name} deployer (CI)"
}

resource "google_project_iam_member" "runtime_datastore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_artifact_registry_repository_iam_member" "deployer_writer" {
  location   = google_artifact_registry_repository.repo.location
  repository = google_artifact_registry_repository.repo.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_project_iam_member" "deployer_run" {
  project = var.project_id
  role    = "roles/run.developer"
  member  = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_service_account_iam_member" "deployer_acts_as_runtime" {
  service_account_id = google_service_account.runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deployer.email}"
}

# --- Firestore ---------------------------------------------------------------

resource "google_firestore_database" "db" {
  name                    = local.name
  location_id             = local.firestore_location
  type                    = "FIRESTORE_NATIVE"
  delete_protection_state = "DELETE_PROTECTION_ENABLED"
  deletion_policy         = "ABANDON"
  depends_on              = [google_project_service.apis]
}

# Garbage collection only: the server checks expiresAt on every read.
resource "google_firestore_field" "ttl" {
  for_each   = toset(local.ttl_collections)
  database   = google_firestore_database.db.name
  collection = each.value
  field      = "expiresAt"
  ttl_config {}
  index_config {}
}

# --- KMS: per-token encryption ----------------------------------------------

resource "google_kms_key_ring" "ring" {
  name       = local.name
  location   = var.region
  depends_on = [google_project_service.apis]
}

resource "google_kms_crypto_key" "tokens" {
  name            = "token-encryption"
  key_ring        = google_kms_key_ring.ring.id
  rotation_period = "7776000s" # 90 days; old versions still decrypt

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_kms_crypto_key_iam_member" "runtime_crypto" {
  crypto_key_id = google_kms_crypto_key.tokens.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${google_service_account.runtime.email}"
}

# --- Secrets (values added out of band, see DEPLOY.md) -----------------------

resource "google_secret_manager_secret" "google_oauth" {
  for_each  = toset(["gtasks-mcp-google-client-id", "gtasks-mcp-google-client-secret"])
  secret_id = each.value
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_iam_member" "runtime_access" {
  for_each  = google_secret_manager_secret.google_oauth
  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}

# --- Cloud Run ---------------------------------------------------------------

resource "google_cloud_run_v2_service" "svc" {
  name                = local.name
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    service_account = google_service_account.runtime.email

    scaling {
      min_instance_count = 0
      max_instance_count = var.max_instances
    }

    containers {
      image = var.image

      ports {
        container_port = 8080
      }

      env {
        name = "GOOGLE_CLIENT_ID"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.google_oauth["gtasks-mcp-google-client-id"].secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "GOOGLE_CLIENT_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.google_oauth["gtasks-mcp-google-client-secret"].secret_id
            version = "latest"
          }
        }
      }

      dynamic "env" {
        for_each = merge({
          GOOGLE_REDIRECT_URI   = "${var.issuer_url}/callback"
          ISSUER_URL            = var.issuer_url
          STORAGE               = "firestore"
          FIRESTORE_DATABASE    = google_firestore_database.db.name
          CIPHER                = "gcpkms"
          KMS_KEY_NAME          = google_kms_crypto_key.tokens.id
          ALLOWED_DOMAIN        = var.allowed_domain
          ALLOWED_REDIRECT_URIS = join(",", var.allowed_redirect_uris)
          TRUST_PROXY_HOPS      = "1"
          PUBLIC_PAGES          = var.public_pages
          ANALYTICS             = "false" # never report a shared server's visitors to upstream's analytics
          LOG_LEVEL             = "info"
        }, var.privacy_policy_url == "" ? {} : { PRIVACY_POLICY_URL = var.privacy_policy_url })
        content {
          name  = env.key
          value = env.value
        }
      }
    }
  }

  lifecycle {
    # Images are deployed out of band (gcloud run deploy / CI).
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }

  depends_on = [
    google_secret_manager_secret_iam_member.runtime_access,
    google_kms_crypto_key_iam_member.runtime_crypto,
    google_project_iam_member.runtime_datastore,
  ]
}

# Public endpoint: the server itself enforces OAuth (and ALLOWED_DOMAIN).
resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.svc.name
  location = google_cloud_run_v2_service.svc.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_domain_mapping" "custom" {
  count    = var.enable_custom_domain ? 1 : 0
  name     = var.custom_domain
  location = var.region

  metadata {
    namespace = var.project_id
  }

  spec {
    route_name = google_cloud_run_v2_service.svc.name
  }
}
