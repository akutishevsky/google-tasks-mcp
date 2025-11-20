#!/usr/bin/env node

import { initOAuthStore } from "./auth/oauth.js";
import { tokenStore } from "./auth/token-store.js";
import { createApp } from "./server/app.js";
import { setOAuthConfig } from "./config.js";
import { initRateLimiter } from "./server/rate-limiter.js";

await tokenStore.init();
await initOAuthStore();
await initRateLimiter();

const oauthConfig = {
  clientId: process.env.GOOGLE_CLIENT_ID || "",
  clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
  redirectUri: process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/callback",
};

setOAuthConfig(oauthConfig);

const app = createApp({ oauthConfig });

export default {
  fetch: app.fetch,
};
