# Google Tasks MCP Server

A Model Context Protocol (MCP) server that brings your Google Tasks into Claude and other MCP-compatible clients. Manage your tasks, task lists, and to-dos through natural conversation.

**🔒 Privacy First**: This repository is public to demonstrate transparency. The code shows that **no personal information is logged or stored maliciously**. All sensitive data (tokens) is encrypted at rest and automatically redacted from logs. You can review the entire codebase to verify this commitment to privacy.

**⚠️ Disclaimer**: This server is provided **as-is** without any guarantees or warranties. While every effort has been made to ensure security and privacy, no guarantees are made about availability, data integrity, or security. Use at your own risk. For production use cases, consider self-hosting your own instance.

## Table of Contents

- [What Can You Do With This?](#what-can-you-do-with-this)
- [Deployment Modes](#deployment-modes)
- [For End Users: Using the Hosted Server](#for-end-users-using-the-hosted-server)
  - [Prerequisites](#prerequisites)
  - [Setup Instructions](#setup-instructions)
  - [Available Tools](#available-tools)
  - [Example Conversations](#example-conversations)
  - [Privacy & Security](#privacy--security)
- [For Developers: Self-Hosting](#for-developers-self-hosting)
  - [Prerequisites](#prerequisites-1)
  - [Step 1: Create Google Cloud Project](#step-1-create-google-cloud-project)
  - [Step 2: Clone and Setup](#step-2-clone-and-setup)
  - [Step 3: Local Development](#step-3-local-development)
  - [Step 4: Deploy to Production](#step-4-deploy-to-production)
  - [Step 5: Update Google OAuth Settings](#step-5-update-google-oauth-settings)
  - [Step 6: Configure Your MCP Client](#step-6-configure-your-mcp-client)
  - [Environment Variables Reference](#environment-variables-reference)
  - [Development Commands](#development-commands)
  - [Project Structure](#project-structure)
- [Security Features](#security-features)
  - [Token Encryption](#token-encryption)
  - [Privacy-Safe Logging](#privacy-safe-logging)
- [Contributing](#contributing)
- [License](#license)
- [Support](#support)
- [Acknowledgments](#acknowledgments)

## What Can You Do With This?

This MCP server gives Claude access to your Google Tasks data, allowing you to:

- **Manage task lists**: Create, read, update, and delete task lists
- **Manage tasks**: Create, read, update, delete, and move tasks
- **Organize tasks**: Create subtasks, set due dates, add notes
- **Mark completion**: Mark tasks as complete or incomplete
- **Batch operations**: Clear all completed tasks from a list
- **Query tasks**: Filter tasks by completion status, due date, and more
- **Natural language**: Interact with your tasks through conversation with Claude

All through natural conversation with Claude or any other MCP-compatible client.

## Deployment Modes

The same server runs in three modes. Pick one by where it runs and who uses it;
the MCP tools and the OAuth flow are identical in all of them.

| | Deno Deploy | Node / container | Google Cloud (shared) |
|---|---|---|---|
| **Best for** | The hosted server; quick personal instance | Self-hosting anywhere that runs Node or Docker | A team on one Google Workspace domain |
| **Runtime** | Deno Deploy (`build/index.js`) | Node 22 (`npm start`) or the `Dockerfile` | Cloud Run, scales to zero |
| **Storage** | Deno KV (managed) | Deno KV file (`KV_PATH`) | Firestore (`STORAGE=firestore`) |
| **Token encryption** | AES-256-GCM, `ENCRYPTION_SECRET` | AES-256-GCM, `ENCRYPTION_SECRET` | Cloud KMS (`CIPHER=gcpkms`), key rotated every 90 days |
| **Who can sign in** | Any Google account | Any Google account, or one domain (`ALLOWED_DOMAIN`) | One Workspace domain (Internal consent screen + `ALLOWED_DOMAIN`) |
| **Set up with** | [Step 4](#deploy-to-deno-deploy) | [Step 4](#run-on-node--in-a-container) | [DEPLOY.md](DEPLOY.md) (Terraform in `infra/`) |
| **Operate with** | Deno Deploy dashboard | [MAINTAIN.md](MAINTAIN.md) | [MAINTAIN.md](MAINTAIN.md), incl. `npm run revoke` |

Every setting beyond the original ones is optional: with only the variables in
the [reference](#environment-variables-reference) set, the server behaves as it
always has on Deno Deploy.

## For End Users: Using the Hosted Server

If you just want to use this MCP server with Claude Desktop without hosting anything yourself, follow these steps:

### Prerequisites

1. A [Google Account](https://accounts.google.com/) with Google Tasks
2. [Claude Desktop](https://claude.ai/download) or any other MCP-compatible client installed on your computer

### Setup Instructions

#### Step 1: Add Connector in Claude Desktop

1. Open Claude Desktop
2. Go to **Settings** (gear icon in the bottom-left corner)
3. Navigate to the **Connectors** tab
4. Click **Add Custom Connector**
5. Fill in the following details:
   - **Name**: `Google Tasks` (or any name you prefer)
   - **Remote MCP server URL**: `https://your-deployed-domain.com/mcp`
6. Click **Add**

#### Step 2: Connect and Authorize

1. In the **Connectors** settings, find the Google Tasks connector you just added
2. Click **Connect** next to the connector
3. Your web browser will open with the Google authorization page
4. Log in to your Google account
5. Review and approve the permissions requested
6. You'll be redirected back and the connection will be complete

After authorization, Claude will have access to your Google Tasks!

### Available Tools

Once connected, Claude can use these tools to access your data:

#### Task Lists Management
- `list_task_lists` - Returns all the authenticated user's task lists
- `get_task_list` - Returns a specific task list
- `insert_task_list` - Creates a new task list
- `update_task_list` - Updates a task list (full update)
- `patch_task_list` - Updates a task list (partial update)
- `delete_task_list` - Deletes a task list

#### Tasks Management
- `list_tasks` - Returns all tasks in a task list
- `get_task` - Returns a specific task
- `insert_task` - Creates a new task
- `update_task` - Updates a task (full update)
- `patch_task` - Updates a task (partial update)
- `delete_task` - Deletes a task
- `clear_completed_tasks` - Clears all completed tasks from a list
- `move_task` - Moves a task to a different position or parent

### Due dates and times

Google's Tasks API keeps only the **date** of a task's due field and discards
the time: "Only date information is recorded; the time portion of the
timestamp is discarded when setting this field. It isn't possible to read or
write the time that a task is scheduled for using the API."
([Task resource reference](https://developers.google.com/workspace/tasks/reference/rest/v1/tasks)).
Times you set in the Google Tasks app are stored privately and are not
visible through the API either.

This server works around that in two ways:

- **Dates are calendar dates.** The assistant resolves words like "tomorrow"
  in your timezone and sends a plain `YYYY-MM-DD`. The server never converts
  it through UTC, so the task lands on the day you meant.
- **Times go in the title.** A time of day is recorded as text at the end of
  the title, for example `Call the dentist (at 3:30 PM)` or
  `Submit report (before 4:30 PM)`. It is your wall-clock time, so there is
  no timezone to get wrong. When the server reads tasks back it exposes the
  time as `due_time` (24-hour `HH:MM`) and `due_time_qualifier` next to the
  due date, so the assistant can answer questions like "what is due at 3pm".

### Example Conversations

Try asking Claude:

- "What task lists do I have?"
- "Show me all tasks in my Work list"
- "Create a new task list called 'Personal Projects'"
- "Add a task 'Review Q4 reports' to my Work list with due date next Friday"
- "Add 'Call the dentist' to my Personal list for tomorrow at 3:30pm"
- "Mark the task 'Buy groceries' as completed"
- "Move 'Write proposal' task to be a subtask of 'Client project'"
- "Clear all completed tasks from my Shopping list"
- "What tasks are due this week?"

### Privacy & Security

- **Encrypted tokens**: All authentication tokens are encrypted using AES-256-GCM before storage
- **No logging of personal data**: The code is public - you can verify that no sensitive information is logged
- **Automatic redaction**: All user IDs, tokens, and credentials are automatically redacted from system logs
- **OAuth 2.0**: Industry-standard secure authentication with Google
- **You're in control**: Revoke access anytime from your Google account settings

---

## For Developers: Self-Hosting

Want to run your own instance? Here's how to deploy this MCP server yourself.

### Prerequisites

1. [Node.js](https://nodejs.org/) 18+ and npm installed
2. [Deno CLI](https://deno.land/) installed, for Deno Deploy only
3. A [Google Cloud Platform](https://console.cloud.google.com/) account

### Step 1: Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google Tasks API:
   - Go to **APIs & Services** → **Library**
   - Search for "Google Tasks API"
   - Click **Enable**
4. Create OAuth 2.0 credentials:
   - Go to **APIs & Services** → **Credentials**
   - Click **Create Credentials** → **OAuth client ID**
   - Choose **Web application**
   - Add authorized redirect URIs: `https://your-domain.com/callback`
   - Note your **Client ID** and **Client Secret**
5. Configure OAuth consent screen:
   - Go to **APIs & Services** → **OAuth consent screen**
   - Add required scopes: `openid`, `email`, `https://www.googleapis.com/auth/tasks`
   - For a Workspace-only server, set the user type to **Internal**

### Step 2: Clone and Setup

```bash
# Clone the repository
git clone https://github.com/akutishevsky/google-tasks-mcp.git
cd google-tasks-mcp

# Install dependencies
npm install

# Generate encryption secret
npm run generate-secret
# Copy the output - you'll need it for environment variables
```

### Step 3: Local Development

> **Note**: Google requires a publicly accessible URL for OAuth callbacks. For local development, use a tunneling service (like ngrok) to expose your local server or deploy to a staging environment for testing.

```bash
# Copy environment template
cp .env.example .env

# Edit .env with your values
# GOOGLE_CLIENT_ID=your_client_id
# GOOGLE_CLIENT_SECRET=your_client_secret
# GOOGLE_REDIRECT_URI=https://your-tunnel-url.com/callback
# ENCRYPTION_SECRET=paste_generated_secret_here
# PORT=3000

# Build the project
npm run build

# Run with Deno (deno serve on port 3000)
deno task dev

# ...or on Node (KV_PATH keeps sessions across restarts)
KV_PATH=./data/kv.sqlite npm start
```

Make sure your redirect URI in the .env file matches the publicly accessible URL pointing to your local server.

### Step 4: Deploy to Production

#### Deploy to Deno Deploy

1. Install Deno Deploy CLI:
```bash
deno install -A --unstable https://deno.land/x/deploy/deployctl.ts
```

2. Deploy the project:
```bash
# Build first
npm run build

# Deploy to Deno Deploy
deployctl deploy --project=google-tasks-mcp build/index.js
```

3. Set environment variables in Deno Deploy dashboard:
   - Go to your project settings
   - Add all required environment variables
   - Restart the deployment

#### Run on Node / in a container

```bash
npm run build
KV_PATH=./data/kv.sqlite npm start   # serves build/node.js on $PORT
```

Set `KV_PATH` on Node: without it Deno KV is **in memory** and every restart
logs everyone out. A `Dockerfile` is included.

#### Deploy to Google Cloud (Cloud Run + Firestore + KMS)

For a shared, multi-user server restricted to a Google Workspace domain, see
[DEPLOY.md](DEPLOY.md) (Terraform in `infra/`) and [MAINTAIN.md](MAINTAIN.md)
(configuration, token model, revoking access). All new settings are optional;
without them the server behaves as before.

### Step 5: Update Google OAuth Settings

Go back to your Google Cloud Console OAuth client and update the redirect URI to match your deployed URL:
`https://your-domain.com/callback`

### Step 6: Configure Your MCP Client

#### For Claude Desktop:

1. Open Claude Desktop
2. Go to **Settings** → **Connectors** tab
3. Click **Add Custom Connector**
4. Fill in the following details:
   - **Name**: `Google Tasks` (or any name you prefer)
   - **Remote MCP server URL**: `https://your-domain.com/mcp`
5. Click **Add**
6. Click **Connect** next to the connector to authorize

#### For Other MCP Clients:

Configure your MCP client with the following connection details:
- **Server URL**: `https://your-domain.com`
- **Transport**: Streamable HTTP (stateless, JSON responses)
- **Endpoint**: `/mcp`
- **Authentication**: OAuth 2.0
- **Discovery URL**: `/.well-known/oauth-authorization-server`

### Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_CLIENT_ID` | Yes | Your Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | Your Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | Yes | OAuth callback URL (must match Google Cloud Console settings) |
| `ENCRYPTION_SECRET` | Yes | 32+ character secret for token encryption (generate with `npm run generate-secret`) |
| `PORT` | No | Server port (default: 3000) |
| `LOG_LEVEL` | No | Logging level: trace, debug, info, warn, error (default: info) |
| `ALLOWED_ORIGINS` | No | Comma-separated list of allowed CORS origins for browser clients |
| `KV_PATH` | No | Deno KV file on Node; unset means in memory (everyone is logged out on restart) |
| `ISSUER_URL` | No | Public base URL; set it behind a proxy or load balancer |
| `ALLOWED_DOMAIN` | No | Only accept accounts from this Google Workspace domain |
| `ALLOWED_REDIRECT_URIS` | No | Allowlist of client redirect URIs; set it on shared servers |
| `PUBLIC_PAGES` | No | `true` (HTML pages), `false` (JSON only) or `auto` (HTML for browsers, JSON otherwise) |
| `ANALYTICS`, `PRIVACY_POLICY_URL` | No | Drop the pages' analytics tag; redirect `/privacy-policy` to your own policy |
| `STORAGE`, `CIPHER` | No | `firestore` and `gcpkms` for the Google Cloud mode (see [MAINTAIN.md](MAINTAIN.md)) |

The full list, including the Google Cloud settings, is in [MAINTAIN.md](MAINTAIN.md#configuration).

### Development Commands

```bash
npm run build            # Compile TypeScript to JavaScript
npm run dev              # Watch mode - recompile on changes
npm test                 # Run the test suite (vitest)
npm start                # Serve build/node.js on Node
npm run revoke -- --email <addr> --dry-run  # Kill switch (see MAINTAIN.md)
npm run generate-secret  # Generate encryption secret for ENCRYPTION_SECRET env variable
```

### Project Structure

```
src/
├── auth/              # OAuth 2.0 authorization server & token storage
├── server/            # Hono app, MCP endpoint, middleware, rate limiting
├── tools/             # MCP tools for Google Tasks API (tasklists, tasks)
├── google/            # Google Tasks API client and Google OAuth
├── store/             # Storage backends: Deno KV, Firestore
├── crypto/            # Token encryption: static key, Cloud KMS
├── cli/               # revoke command
├── utils/             # Logger and timestamp helpers
├── config.ts          # Environment → validated config
├── deps.ts            # Wires store, cipher, clock and fetch
├── index.ts           # Deno Deploy entry point
└── node.ts            # Node entry point
infra/                 # Terraform for the Google Cloud mode
```

## Security Features

### Token Encryption

All Google access and refresh tokens are encrypted at rest, using **AES-256-GCM**
with `ENCRYPTION_SECRET` (below) or, in the Google Cloud mode, **Cloud KMS**:

- **Algorithm**: AES-256-GCM (authenticated encryption)
- **Key Derivation**: PBKDF2 with 100,000 iterations
- **Defense in Depth**: Even if the database is compromised, tokens remain protected

**Important**: Keep your `ENCRYPTION_SECRET`:
- At least 32 characters long
- Randomly generated (use `npm run generate-secret`)
- Secure and never committed to version control
- Consistent across server restarts

### Privacy-Safe Logging

The custom logger automatically redacts all sensitive information:
- ✅ Operational events and errors logged
- ❌ No tokens, credentials, or auth codes
- ❌ No user IDs or personal information
- ❌ No API request/response payloads with sensitive data

You can review the logging implementation in `src/utils/logger.ts`.

## Contributing

This is a personal project, but contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Support

- **Issues**: Report bugs or request features on [GitHub Issues](https://github.com/akutishevsky/google-tasks-mcp/issues)
- **Google Tasks API**: See [Google Tasks API Documentation](https://developers.google.com/workspace/tasks/reference/rest)
- **MCP Protocol**: See [Model Context Protocol Documentation](https://modelcontextprotocol.io/)

## Acknowledgments

Built with:
- [Model Context Protocol](https://modelcontextprotocol.io/) by Anthropic
- [Google Tasks API](https://developers.google.com/workspace/tasks)
- [Hono](https://hono.dev/) web framework
- [Deno Deploy](https://deno.com/deploy) for hosting
