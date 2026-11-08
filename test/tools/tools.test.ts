// Boundary handler: the 14 tools, through /mcp. Oracle: recorded Google
// responses; *_readable fields recomputed independently here (TZ=UTC).
import { beforeEach, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "../support/test-server.ts";
import { login } from "../support/oauth-driver.ts";
import { callTool } from "../support/mcp-client.ts";
import { loadFixture } from "../support/google-fake.ts";
import { TOOL_CASES } from "../support/tool-cases.ts";

const NO_BODY_TEXT: Record<string, string> = {
  delete_task_list: "Task list deleted successfully",
  delete_task: "Task deleted successfully",
  clear_completed_tasks: "Completed tasks cleared successfully",
};

const TS_KEYS = new Set(["updated", "completed", "due", "created"]);
function withReadable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(withReadable);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      out[k] = withReadable(x);
      if (TS_KEYS.has(k) && typeof x === "string") out[`${k}_readable`] = new Date(x).toLocaleString("en-US", { timeZone: "UTC" });
    }
    return out;
  }
  return v;
}

const text = (r: { result?: { content?: Array<{ text: string }> } }) => r.result?.content?.[0]?.text ?? "";
// list_tasks appends usage warnings after the JSON, separated by a blank line.
const jsonPart = (t: string) => JSON.parse(t.split("\n\n⚠️")[0]);
const tasksCalls = (s: TestServer) => s.google.calls.filter((c) => c.url.pathname.startsWith("/tasks/"));

describe("tools", () => {
  let s: TestServer;
  let token: string;

  beforeEach(async () => {
    s = await startTestServer();
    token = (await login(s.app, s.google)).tokens.access_token;
  });

  for (const c of TOOL_CASES) {
    it(`${c.tool}_ok`, async () => {
      s.google.queue(`${c.endpoint}.ok`);
      const r = await callTool(s.app, token, c.tool, c.args);
      expect(r.status).toBe(200);
      expect(r.result.isError).toBeFalsy();

      const call = s.google.calls.at(-1)!;
      expect(call.method).toBe(c.method);
      expect(decodeURIComponent(call.url.pathname)).toBe(c.path);
      for (const [k, v] of Object.entries(c.query ?? {})) expect(call.url.searchParams.get(k)).toBe(v);
      expect(call.headers.get("authorization")).toBe("Bearer PLANTED_GOOGLE_ACCESS_A");

      if (NO_BODY_TEXT[c.tool]) {
        expect(text(r)).toBe(NO_BODY_TEXT[c.tool]);
      } else {
        expect(jsonPart(text(r))).toEqual(withReadable(loadFixture(`${c.endpoint}.ok`).response.body));
      }
    });

    it(`${c.tool}_google_error`, async () => {
      const f = loadFixture(`${c.endpoint}.err`);
      s.google.queue(`${c.endpoint}.err`);
      const r = await callTool(s.app, token, c.tool, c.args);
      expect(r.status).toBe(200);
      expect(r.result.isError).toBe(true);
      expect(text(r)).toContain(String(f.response.status));
      expect(text(r)).toContain((f.response.body as { error: { message: string } }).error.message);
    });
  }

  it("tool_invalid_args", async () => {
    const r = await callTool(s.app, token, "get_task", { taskListId: "PLANTED_LIST_1" });
    expect(r.status).toBe(200);
    expect(r.error ?? r.result?.isError).toBeTruthy();
    expect(tasksCalls(s)).toHaveLength(0);
  });

  it("two_users_isolated", async () => {
    const exchangeB = loadFixture("token.exchange.ok").response.body as Record<string, unknown>;
    const b = await login(s.app, s.google, {
      exchangeOverrides: { body: { ...exchangeB, access_token: "PLANTED_GOOGLE_ACCESS_B", refresh_token: "PLANTED_GOOGLE_REFRESH_B" } },
    });
    s.google.queue("tasklists.list.ok");
    s.google.queue("tasklists.list.ok");
    s.google.queue("tasklists.list.ok");
    await callTool(s.app, token, "list_task_lists", {});
    await callTool(s.app, b.tokens.access_token, "list_task_lists", {});
    await callTool(s.app, token, "list_task_lists", {});
    const auths = tasksCalls(s).map((c) => c.headers.get("authorization"));
    expect(auths).toEqual(["Bearer PLANTED_GOOGLE_ACCESS_A", "Bearer PLANTED_GOOGLE_ACCESS_B", "Bearer PLANTED_GOOGLE_ACCESS_A"]);
  });

  it("unicode_long_title_roundtrip", async () => {
    const title = ("Plan 🚀 计划 ✅ — naïve façade ").repeat(80).slice(0, 2000);
    s.google.queue("tasks.insert.ok");
    const r = await callTool(s.app, token, "insert_task", { taskListId: "PLANTED_LIST_1", title });
    expect(r.result.isError).toBeFalsy();
    expect(JSON.parse(s.google.calls.at(-1)!.body).title).toBe(title);
  });

  it("list_tasks_paged", async () => {
    s.google.queue("tasks.list.page2");
    const r = await callTool(s.app, token, "list_tasks", { taskListId: "PLANTED_LIST_1", pageToken: "P2" });
    expect(s.google.calls.at(-1)!.url.searchParams.get("pageToken")).toBe("P2");
    expect(jsonPart(text(r)).nextPageToken).toBe("P3");
  });

  it("list_tasks_completed_warning", async () => {
    s.google.queue("tasks.list.ok");
    const r = await callTool(s.app, token, "list_tasks", { taskListId: "PLANTED_LIST_1", showCompleted: true });
    expect(text(r)).toContain("⚠️ COMPLETED TASKS");
    s.google.queue("tasks.list.ok");
    const r2 = await callTool(s.app, token, "list_tasks", { taskListId: "PLANTED_LIST_1", showCompleted: true, showHidden: true });
    expect(text(r2)).not.toContain("⚠️");
  });
});
