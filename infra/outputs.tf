output "service_url" {
  description = "Cloud Run URL (run.app)."
  value       = google_cloud_run_v2_service.svc.uri
}

output "domain_dns_records" {
  description = "DNS records to create for the custom domain."
  value       = var.enable_custom_domain ? google_cloud_run_domain_mapping.custom[0].status[0].resource_records : []
}

output "runtime_sa_email" {
  value = google_service_account.runtime.email
}

output "deployer_sa_email" {
  value = google_service_account.deployer.email
}

output "kms_key_name" {
  description = "Value for KMS_KEY_NAME (also used by npm run revoke)."
  value       = google_kms_crypto_key.tokens.id
}

output "artifact_registry" {
  description = "Image path prefix for docker push."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.repo.repository_id}"
}

output "firestore_database" {
  value = google_firestore_database.db.name
}
