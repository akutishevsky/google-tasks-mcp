// Planted, non-secret placeholder values used across tests. None of these is a
// real credential; they exist so oracles can search for them (invariants).
export const PLANTED_GOOGLE_CLIENT_ID = "planted-client-id";
export const PLANTED_GOOGLE_CLIENT_CREDENTIAL = ["planted", "client", "credential"].join("-");
export const PLANTED_KEY_MATERIAL = "0".repeat(64);
export const PLANTED_REDIRECT_URI = "http://localhost:3000/callback";
