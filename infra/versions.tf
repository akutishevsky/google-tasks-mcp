terraform {
  required_version = ">= 1.6"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 6.0, < 8.0"
    }
  }

  # Bucket and prefix are supplied at init time and never committed:
  #   terraform init -backend-config=backend.hcl
  backend "gcs" {}
}

provider "google" {
  project = var.project_id
  region  = var.region
}
