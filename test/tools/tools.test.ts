// Boundary handler: the 14 tools, through /mcp. Oracle: recorded Google
// responses; *_readable fields recomputed independently here (TZ=UTC).
import { beforeEach, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "../support/test-server.ts";
import { login } from "../support/oauth-driver.ts";
import { callTool, mcp } from "../support/mcp-client.ts";
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
      if (k === "due" && typeof x === "string") {
        out.due_readable = new Date(x).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", year: "numeric", month: "long", day: "numeric" });
      } else if (TS_KEYS.has(k) && typeof x === "string") {
        out[`${k}_readable`] = new Date(x).toLocaleString("en-US", { timeZone: "UTC" });
      }
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

// Due dates are calendar dates; due times live in the title because Google's
// API discards them. See docs/specs/2026-10-23-due-time-design.md.
describe("due time", () => {
  let s: TestServer;
  let token: string;
  const L = "PLANTED_LIST_1";
  const T = "PLANTED_TASK_1";
  const body = (c: { body: string }) => JSON.parse(c.body);

  beforeEach(async () => {
    s = await startTestServer();
    token = (await login(s.app, s.google)).tokens.access_token;
  });

  it("insert_task_appends_time_to_title_and_normalises_due", async () => {
    s.google.queue("tasks.insert.ok");
    const r = await callTool(s.app, token, "insert_task", { taskListId: L, title: "Call the dentist", due: "2026-10-20", dueTime: "15:30" });
    expect(r.result.isError).toBeFalsy();
    expect(body(s.google.calls.at(-1)!)).toMatchObject({ title: "Call the dentist (at 3:30 PM)", due: "2026-10-20T00:00:00.000Z" });
    expect(body(s.google.calls.at(-1)!)).not.toHaveProperty("dueTime");
  });

  it("insert_task_keeps_local_date_for_offset_timestamp", async () => {
    s.google.queue("tasks.insert.ok");
    await callTool(s.app, token, "insert_task", { taskListId: L, title: "T", due: "2025-01-15T22:00:00-08:00" });
    expect(body(s.google.calls.at(-1)!).due).toBe("2025-01-15T00:00:00.000Z");
  });

  it("insert_task_invalid_due_no_google_call", async () => {
    const r = await callTool(s.app, token, "insert_task", { taskListId: L, title: "T", due: "2025-02-30" });
    expect(r.result.isError).toBe(true);
    expect(text(r)).toContain('Invalid due date "2025-02-30": expected YYYY-MM-DD');
    expect(tasksCalls(s)).toHaveLength(0);
  });

  it("patch_task_due_time_keeps_title", async () => {
    s.google.queue("tasks.get.ok"); // title "Task 1"
    s.google.queue("tasks.patch.ok");
    await callTool(s.app, token, "patch_task", { taskListId: L, taskId: T, dueTime: "16:30", dueTimeQualifier: "before" });
    const calls = tasksCalls(s);
    expect(calls.map((c) => c.method)).toEqual(["GET", "PATCH"]);
    expect(body(calls[1])).toEqual({ title: "Task 1 (before 4:30 PM)" });
  });

  it("update_task_with_title_and_due_time_does_not_fetch", async () => {
    s.google.queue("tasks.update.ok");
    await callTool(s.app, token, "update_task", { taskListId: L, taskId: T, title: "Dentist (at 3:30 PM)", dueTime: "" });
    const calls = tasksCalls(s);
    expect(calls.map((c) => c.method)).toEqual(["PUT"]);
    expect(body(calls[0]).title).toBe("Dentist");
  });

  it("get_task_exposes_due_time_fields", async () => {
    const f = loadFixture("tasks.get.ok");
    s.google.queue("tasks.get.ok", { body: { ...(f.response.body as object), title: "Task 1 (at 3:30 PM)" } });
    const r = await callTool(s.app, token, "get_task", { taskListId: L, taskId: T });
    expect(jsonPart(text(r))).toMatchObject({ title: "Task 1 (at 3:30 PM)", due_time: "15:30", due_time_qualifier: "at" });
  });

  it("update_task_due_time_only_keeps_other_fields", async () => {
    s.google.queue("tasks.get.ok"); // title "Task 1", due 2026-10-20, notes, status
    s.google.queue("tasks.update.ok");
    await callTool(s.app, token, "update_task", { taskListId: L, taskId: T, dueTime: "15:00" });
    const calls = tasksCalls(s);
    expect(calls.map((c) => c.method)).toEqual(["GET", "PUT"]);
    // PUT is a full replacement: fields the caller did not change must survive.
    expect(body(calls[1])).toMatchObject({ title: "Task 1 (at 3:00 PM)", due: "2026-10-20T00:00:00.000Z", notes: "Notes for task 1", status: "needsAction" });
  });

  it("title_descriptions_warn_about_the_suffix", async () => {
    const r = await mcp(s.app, token, "tools/list");
    const tools = r.messages.find((m) => m.result)!.result.tools as Array<{ name: string; inputSchema: any }>;
    for (const name of ["insert_task", "update_task", "patch_task"]) {
      const desc = tools.find((t) => t.name === name)!.inputSchema.properties.title.description as string;
      expect(desc, name).toContain("dueTime");
    }
  });

  it("insert_task_rejects_malformed_due_time", async () => {
    s.google.queue("tasks.insert.ok");
    const r = await callTool(s.app, token, "insert_task", { taskListId: L, title: "T", dueTime: "3:30 PM" });
    expect(r.error ?? r.result?.isError).toBeTruthy();
    expect(tasksCalls(s)).toHaveLength(0);
    expect(s.google.pending()).toBe(1);
  });
});
