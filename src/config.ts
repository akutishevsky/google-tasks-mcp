export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

let oauthConfig: OAuthConfig | null = null;

export function setOAuthConfig(config: OAuthConfig) {
  oauthConfig = config;
}

export function getOAuthConfig(): OAuthConfig {
  if (!oauthConfig) {
    throw new Error("OAuth config not initialized");
  }
  return oauthConfig;
}
