# SETUP: Connecting the Google Tasks MCP Server to the Claude App

This runbook covers everything needed to deploy this server to Deno Deploy and connect it to the Claude app (claude.ai) as a custom connector.

It is written for a single user (personal) deployment. Where a step requires your own Google or Deno login, it is called out explicitly.

The MCP server is remote, served over stateless Streamable HTTP (JSON responses) at the /mcp endpoint with bearer auth. It implements OAuth discovery at /.well-known/oauth-authorization-server and /.well-known/oauth-protected-resource, an authorization endpoint at /authorize, and a callback at /callback. The Google scopes used are openid, email and https://www.googleapis.com/auth/tasks.

For a shared server for a team on one Google Workspace domain (Cloud Run, Firestore, Cloud KMS), see DEPLOY.md instead; the Deployment Modes section of the README compares the options.

## Overview of what you will do

1. Enable the Google Tasks API in Google Cloud Console.
2. Configure the OAuth consent screen (External), add yourself as a test user, and add the tasks scope.
3. Create a Web application OAuth client and set its authorized redirect URI.
4. Deploy this repo to Deno Deploy and set the environment variables.
5. Update the Google OAuth client redirect URI to your live domain.
6. Add the custom connector in the Claude app and authorize it.

Throughout this document, replace YOUR_DEPLOYED_DOMAIN with your actual Deno Deploy domain (for example, google-tasks-mcp.deno.dev).

## Prerequisites

A Google account that has Google Tasks. A Deno Deploy account (sign in with GitHub at https://dash.deno.com). The forked repository connected to Deno Deploy, or the Deno CLI installed locally if you prefer deploying with deployctl.

## Step 1: Enable the Google Tasks API

1. Go to the Google Cloud Console: https://console.cloud.google.com
2. Create a new project (or select an existing one). A simple name like "google-tasks-mcp" is fine.
3. In the left navigation, open APIs and Services, then Library.
4. Search for "Google Tasks API" and open it.
5. Click Enable.

## Step 2: Configure the OAuth consent screen

1. In APIs and Services, open OAuth consent screen.
2. Choose User Type: External. (External is required because this is not a Google Workspace internal app; it still works for personal single-user use.)
3. Click Create, then fill in the required fields:
   - App name: Google Tasks MCP (or any name you prefer).
   - User support email: your email.
   - Developer contact email: your email.
4. On the Scopes step, click Add or Remove Scopes, then add these scopes: openid, email, and https://www.googleapis.com/auth/tasks
   (If it is not in the filtered list, paste it into the "Manually add scopes" box, click Add to Table, then Update.)
5. On the Test users step, click Add Users and add the Google account you will use with Claude. This must be the same account you authorize later.
6. Save and continue to the summary.

### GOTCHA: the 7 day refresh token expiry in testing mode (read this)

While the OAuth consent screen is left in "Testing" publishing status, Google expires the refresh token after 7 days. That forces you to re-authorize the connector roughly once a week, which is annoying for a personal always-on connector.

Recommendation for single-user personal use: publish the consent screen to production to avoid the weekly re-auth.

To do this, go to APIs and Services, OAuth consent screen, and click Publish App (move publishing status from Testing to In production). For a single sensitive scope like Google Tasks used only by you, Google typically does not require full verification for the app to function, although the consent screen may show an "unverified app" warning that you can click through (Advanced, then "Go to App"). Verification is generally only mandatory if you intend to distribute the app to many external users. Since this is your own personal connector, publishing to production removes the 7 day token expiry without needing a formal verification review for personal use.

If you would rather not publish, you can leave it in Testing, but expect to click Connect again in Claude about every 7 days.

## Step 3: Create the Web application OAuth client

1. In APIs and Services, open Credentials.
2. Click Create Credentials, then OAuth client ID.
3. Application type: Web application.
4. Name: google-tasks-mcp web client (or any name).
5. Under Authorized redirect URIs, click Add URI and enter:
   https://YOUR_DEPLOYED_DOMAIN/callback
   (You may not know the exact domain until after Step 4. You can either deploy first and come back, or set a placeholder now and edit it in Step 5.)
6. Click Create.
7. Copy the Client ID and Client Secret. You will paste these into Deno Deploy as GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.

Note: The redirect URI in Google must match GOOGLE_REDIRECT_URI exactly, including https and the /callback path.

## Step 4: Deploy to Deno Deploy

The entry point compiles from src/index.ts to build/index.js (see tsconfig.json, outDir build). The compiled module exports a default object with a fetch handler, which is exactly the format Deno Deploy expects:

    export default { fetch: app.fetch };

The server also serves static files from the public directory (the landing page, privacy policy, and favicon), so the public folder must be included in the deployment.

You can deploy either from the Deno Deploy dashboard (recommended, no local toolchain needed) or with the deployctl CLI.

### Option A: Deno Deploy dashboard (GitHub integration)

1. Go to https://dash.deno.com and sign in with GitHub.
2. Click New Project.
3. Select your forked repository: Gabriel-Dalton/google-tasks-mcp.
4. For the entry point, set: build/index.js
   Important: build/ is gitignored, so it is not in the repo. Either:
   (a) Configure the project to run the build step. In the project Build settings, set the install step to "npm install" and the build command to "npm run build" so Deno Deploy produces build/index.js before serving; or
   (b) Use the Deno-native entry point src/index.ts directly. Because tsconfig uses rewriteRelativeImportExtensions and the source already uses .ts import specifiers, Deno can run src/index.ts without a separate tsc step. If you choose this, set the entry point to src/index.ts and skip the build command.
5. Set the environment variables (see the table in Step 4c) in the project Settings, Environment Variables.
6. Deploy. Note the production URL Deno assigns (for example https://google-tasks-mcp.deno.dev). That is your YOUR_DEPLOYED_DOMAIN.

### Option B: deployctl CLI (local)

This requires the Deno CLI and a Deno Deploy access token, and it requires your Deno login. Do not paste your token into this document or any web form.

    # Install deno (if not installed), then build and deploy
    npm install
    npm run build
    deployctl deploy --project=google-tasks-mcp --include=build,public build/index.js

The --include=build,public flag ensures both the compiled entry point and the static public assets are uploaded. After deploying, set the environment variables in the dashboard (deployctl can also set them with --env or --env-file, but never commit a file containing real secrets).

### Step 4c: Environment variables to set in Deno Deploy

Set these in Deno Deploy under Project Settings, Environment Variables:

| Variable | Required | Value to use |
| --- | --- | --- |
| GOOGLE_CLIENT_ID | Yes | The Client ID from Step 3. |
| GOOGLE_CLIENT_SECRET | Yes | The Client Secret from Step 3. |
| GOOGLE_REDIRECT_URI | Yes | https://YOUR_DEPLOYED_DOMAIN/callback (must match the Google redirect URI exactly). |
| ENCRYPTION_SECRET | Yes | A 32+ character random secret. Generate locally with: npm run generate-secret (it prints a line beginning with ENCRYPTION_SECRET=; use only the hex value after the equals sign). |
| ALLOWED_ORIGINS | Recommended | https://claude.ai |
| PORT | No | Leave unset on Deno Deploy (it uses the fetch handler, not a port). Useful only for local runs (default 3000). |
| LOG_LEVEL | No | info (or debug while troubleshooting). |

Keep ENCRYPTION_SECRET stable across restarts. If it changes, previously stored encrypted tokens can no longer be decrypted and you will have to re-authorize.

The other settings (ALLOWED_DOMAIN, ALLOWED_REDIRECT_URIS, ISSUER_URL and more) are optional; see the configuration table in MAINTAIN.md.

## Step 5: Update the Google OAuth redirect URI

Once you know your live domain from Step 4, go back to Google Cloud Console, APIs and Services, Credentials, open your Web application OAuth client, and make sure Authorized redirect URIs contains exactly:

    https://YOUR_DEPLOYED_DOMAIN/callback

Confirm it matches the GOOGLE_REDIRECT_URI environment variable in Deno Deploy. Save.

You can sanity check the deployment by visiting:

    https://YOUR_DEPLOYED_DOMAIN/.well-known/oauth-authorization-server

It should return a JSON document describing the issuer, authorization_endpoint (/authorize), token_endpoint (/token), and mcp_endpoint (/mcp).

## Step 6: Add the custom connector in the Claude app

1. Open the Claude app (claude.ai or the desktop app).
2. Go to Settings.
3. Open Connectors.
4. Click Add custom connector.
5. Fill in:
   - Name: Google Tasks (or any name you prefer).
   - Remote MCP server URL: https://YOUR_DEPLOYED_DOMAIN/mcp
6. Click Add.
7. Find the new connector and click Connect.
8. A browser window opens with the Google authorization page. Sign in with the same Google account you added as a test user (or that owns the published app), and approve the Google Tasks permission.
9. You are redirected back and the connection completes.

After connecting, you can ask Claude things like "What task lists do I have?" or "Add a task to my Work list due Friday."

## Troubleshooting

If the Google consent screen shows "access blocked" or "app not verified": confirm your Google account is listed as a test user (Testing mode), or that the app is published to production. The unverified warning can be bypassed for your own account via Advanced, then Go to App.

If Claude cannot connect or CORS errors appear: confirm ALLOWED_ORIGINS includes https://claude.ai exactly (no trailing slash), and that the discovery URL returns valid JSON.

If you must re-authorize every week: your consent screen is still in Testing mode. Publish to production (see the gotcha in Step 2).

If tokens stop working after a redeploy: confirm ENCRYPTION_SECRET did not change between deployments.

## Security notes

Never commit real secrets. The .env file is listed in .gitignore (alongside build/ and node_modules/), so a local .env will not be tracked. Keep .env.example with placeholder values only.
