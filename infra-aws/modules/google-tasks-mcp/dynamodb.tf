# --- DynamoDB: single-table store -------------------------------------------

# pk (partition) + sk (sort), both strings; numeric `ttl` attribute (epoch
# seconds) drives DynamoDB TTL. The server checks `expiresAt` (epoch ms) on
# every read, so DynamoDB TTL is garbage collection only.
module "dynamodb" {
  source  = "terraform-aws-modules/dynamodb-table/aws"
  version = "5.5.2"

  name         = local.name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attributes = [
    { name = "pk", type = "S" },
    { name = "sk", type = "S" },
  ]

  ttl_enabled        = true
  ttl_attribute_name = "ttl"

  point_in_time_recovery_enabled = true
}
