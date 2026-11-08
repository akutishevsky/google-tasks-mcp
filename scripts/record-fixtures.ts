// One-off recorder for test/fixtures/google. Runs a loopback OAuth flow with a
// desktop-type OAuth client, exercises every Tasks endpoint against a throwaway
// list, then rewrites tokens, ids, etags and emails to planted values.
//
//   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... npx tsx scripts/record-fixtures.ts
//
// Use a test Google account. Nothing outside the throwaway list is touched.
import { createServer } from "node:http";
import crypto from "node:crypto";
import { Buffer } from "node:buffer";
import { writeFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("../test/fixtures/google/", import.meta.url));
const SCOPE = "openid email https://www.googleapis.com/auth/tasks";
const TASKS = "https://tasks.googleapis.com";
const OAUTH = "https://oauth2.googleapis.com";

type Recorded = { name: string; method: string; path: string; status: number; body: unknown };
const recorded: Recorded[] = [];
const planted = new Map<string, string>();

function plant(real: string | undefined, value: string) {
  if (real && !planted.has(real)) planted.set(real, value);
}

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (desktop OAuth client).");
  process.exit(2);
}

async function authorize(): Promise<{ code: string; redirectUri: string; verifier: string }> {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const state = crypto.randomUUID();
  return await new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const code = url.searchParams.get("code");
      if (!code || url.searchParams.get("state") !== state) {
        res.writeHead(400).end("Missing code or bad state");
        return;
      }
      res.writeHead(200, { "content-type": "text/plain" }).end("Recorded. You can close this tab.");
      server.close();
      resolve({ code, redirectUri, verifier });
    });
    let redirectUri = "";
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") return reject(new Error("no port"));
      redirectUri = `http://127.0.0.1:${addr.port}/`;
      const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      u.search = new URLSearchParams({
        response_type: "code",
        client_id: clientId!,
        redirect_uri: redirectUri,
        scope: SCOPE,
        state,
        access_type: "offline",
        prompt: "consent",
        code_challenge: challenge,
        code_challenge_method: "S256",
      }).toString();
      console.log(`Open this URL and sign in with the TEST account:\n\n${u}\n`);
    });
  });
}

async function call(
  name: string | null,
  method: string,
  base: string,
  pattern: string,
  params: Record<string, string>,
  opts: { token?: string; json?: unknown; form?: Record<string, string>; query?: Record<string, string> } = {},
): Promise<{ status: number; body: any }> {
  const path = pattern.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(params[k]));
  const qs = opts.query ? `?${new URLSearchParams(opts.query)}` : "";
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let body: string | undefined;
  if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  } else if (opts.form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(opts.form).toString();
  }
  const res = await fetch(`${base}${path}${qs}`, { method, headers, body });
  const text = await res.text();
  const parsed = text ? JSON.parse(text) : null;
  if (name) {
    const wantOk = !name.endsWith(".err") && !name.endsWith(".invalid_grant");
    if (wantOk !== res.ok) {
      console.warn(`SKIP ${name}: expected ${wantOk ? "success" : "failure"}, got ${res.status}`);
    } else {
      recorded.push({ name, method, path: pattern, status: res.status, body: parsed });
    }
  }
  return { status: res.status, body: parsed };
}

function plantedIdToken(real: string): string {
  const [h, p] = real.split(".");
  const claims = JSON.parse(Buffer.from(p, "base64url").toString("utf-8"));
  if (claims.email) claims.email = "a@example.com";
  if (claims.hd) claims.hd = "example.com";
  claims.sub = "100000000000000000001";
  claims.aud = "planted-client-id";
  claims.azp = "planted-client-id";
  delete claims.at_hash;
  const header = JSON.parse(Buffer.from(h, "base64url").toString("utf-8"));
  header.kid = "planted";
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc(header)}.${enc(claims)}.planted-signature`;
}

function redact(value: unknown): unknown {
  let text = JSON.stringify(value);
  // Longest first so a token that contains another is replaced whole.
  for (const [real, fake] of [...planted].sort((a, b) => b[0].length - a[0].length)) {
    text = text.split(real).join(fake);
  }
  text = text.replace(/"etag":"\\"[^"\\]*\\""/g, '"etag":"\\"PLANTED_ETAG\\""');
  text = text.replace(/[A-Za-z0-9._%+-]+@gmail\.com/g, "a@example.com");
  return JSON.parse(text);
}

async function main() {
  const { code, redirectUri, verifier } = await authorize();
  const tokenForm = {
    code,
    client_id: clientId!,
    client_secret: clientSecret!,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    code_verifier: verifier,
  };
  const ex = await call("token.exchange.ok", "POST", OAUTH, "/token", {}, { form: tokenForm });
  await call("token.exchange.err", "POST", OAUTH, "/token", {}, { form: tokenForm });
  const at: string = ex.body.access_token;
  const rt: string = ex.body.refresh_token;
  plant(at, "PLANTED_GOOGLE_ACCESS_A");
  plant(rt, "PLANTED_GOOGLE_REFRESH_A");
  plant(ex.body.id_token, plantedIdToken(ex.body.id_token));

  const LIST = "/tasks/v1/users/@me/lists";
  const L1 = `${LIST}/{tasklist}`;
  const TS = "/tasks/v1/lists/{tasklist}/tasks";
  const T1 = `${TS}/{task}`;
  const t = { token: at };
  const MISSING = "does-not-exist";

  const list = await call("tasklists.insert.ok", "POST", TASKS, LIST, {}, { ...t, json: { title: `fixture-recorder-${Date.now()}` } });
  const tasklist: string = list.body.id;
  plant(tasklist, "PLANTED_LIST_1");
  try {
    await call("tasklists.list.ok", "GET", TASKS, LIST, {}, { ...t, query: { maxResults: "100" } });
    await call("tasklists.list.err", "GET", TASKS, LIST, {}, { ...t, query: { maxResults: "-5" } });
    await call("tasklists.get.ok", "GET", TASKS, L1, { tasklist }, t);
    await call("tasklists.get.err", "GET", TASKS, L1, { tasklist: MISSING }, t);
    await call("tasklists.update.ok", "PUT", TASKS, L1, { tasklist }, { ...t, json: { id: tasklist, title: "Renamed" } });
    await call("tasklists.update.err", "PUT", TASKS, L1, { tasklist: MISSING }, { ...t, json: { id: MISSING, title: "x" } });
    await call("tasklists.patch.ok", "PATCH", TASKS, L1, { tasklist }, { ...t, json: { title: "Patched" } });
    await call("tasklists.patch.err", "PATCH", TASKS, L1, { tasklist: MISSING }, { ...t, json: { title: "x" } });
    await call("tasklists.insert.err", "POST", TASKS, LIST, {}, { ...t, json: { title: "x".repeat(2000) } });

    const ids: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const r = await call(i === 1 ? "tasks.insert.ok" : null, "POST", TASKS, TS, { tasklist }, {
        ...t,
        json: { title: `Task ${i}`, notes: `Notes for task ${i}`, due: "2026-10-20T00:00:00.000Z" },
      });
      ids.push(r.body.id);
      plant(r.body.id, `PLANTED_TASK_${i}`);
    }
    await call("tasks.insert.err", "POST", TASKS, TS, { tasklist }, { ...t, json: { title: "bad", due: "not-a-date" } });
    const p1 = await call("tasks.list.ok", "GET", TASKS, TS, { tasklist }, { ...t, query: { maxResults: "2" } });
    plant(p1.body.nextPageToken, "P2");
    const p2 = await call("tasks.list.page2", "GET", TASKS, TS, { tasklist }, { ...t, query: { maxResults: "2", pageToken: p1.body.nextPageToken } });
    plant(p2.body.nextPageToken, "P3");
    await call("tasks.list.err", "GET", TASKS, TS, { tasklist: MISSING }, t);
    const [a, b, c] = ids;
    await call("tasks.get.ok", "GET", TASKS, T1, { tasklist, task: a }, t);
    await call("tasks.get.err", "GET", TASKS, T1, { tasklist, task: MISSING }, t);
    await call("tasks.update.ok", "PUT", TASKS, T1, { tasklist, task: a }, { ...t, json: { id: a, title: "Updated" } });
    await call("tasks.update.err", "PUT", TASKS, T1, { tasklist, task: MISSING }, { ...t, json: { id: MISSING, title: "x" } });
    await call("tasks.patch.ok", "PATCH", TASKS, T1, { tasklist, task: a }, { ...t, json: { title: "Patched" } });
    await call("tasks.patch.err", "PATCH", TASKS, T1, { tasklist, task: MISSING }, { ...t, json: { title: "x" } });
    await call("tasks.move.ok", "POST", TASKS, `${T1}/move`, { tasklist, task: a }, { ...t, query: { parent: b } });
    await call("tasks.move.err", "POST", TASKS, `${T1}/move`, { tasklist, task: MISSING }, t);
    await call(null, "PATCH", TASKS, T1, { tasklist, task: c }, { ...t, json: { status: "completed" } });
    await call("tasks.clear.ok", "POST", TASKS, "/tasks/v1/lists/{tasklist}/clear", { tasklist }, t);
    await call("tasks.clear.err", "POST", TASKS, "/tasks/v1/lists/{tasklist}/clear", { tasklist: MISSING }, t);
    await call("tasks.delete.ok", "DELETE", TASKS, T1, { tasklist, task: a }, t);
    await call("tasks.delete.err", "DELETE", TASKS, T1, { tasklist, task: MISSING }, t);
    await call("tasklists.delete.err", "DELETE", TASKS, L1, { tasklist: MISSING }, t);
  } finally {
    await call("tasklists.delete.ok", "DELETE", TASKS, L1, { tasklist }, t);
  }

  const refreshForm = { refresh_token: rt, client_id: clientId!, client_secret: clientSecret!, grant_type: "refresh_token" };
  const rf = await call("token.refresh.ok", "POST", OAUTH, "/token", {}, { form: refreshForm });
  plant(rf.body.access_token, "PLANTED_GOOGLE_ACCESS_A_REFRESHED");
  if (rf.body.id_token) plant(rf.body.id_token, plantedIdToken(rf.body.id_token));
  await call("token.revoke.ok", "POST", OAUTH, "/revoke", {}, { form: { token: rt } });
  await call("token.refresh.invalid_grant", "POST", OAUTH, "/token", {}, { form: refreshForm });

  for (const r of recorded) {
    const fixture = {
      _provenance: "recorded",
      request: { method: r.method, path: r.path },
      response: { status: r.status, body: redact(r.body) },
    };
    writeFileSync(`${OUT}${r.name}.json`, JSON.stringify(fixture, null, 2) + "\n");
    console.log(`wrote ${r.name} (${r.status})`);
  }
  console.log(`\n${recorded.length} fixtures written. Review the diff before committing.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
