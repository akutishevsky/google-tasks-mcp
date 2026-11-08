import { describe, expect, it } from "vitest";
import { GoogleFake } from "./google-fake.ts";

describe("GoogleFake", () => {
  it("unexpected_call_throws", async () => {
    const g = new GoogleFake();
    await expect(g.fetch("https://tasks.googleapis.com/tasks/v1/users/@me/lists")).rejects.toThrow(
      "Unexpected Google call: GET /tasks/v1/users/@me/lists",
    );
    g.queue("tasklists.list.ok");
    await expect(g.fetch("https://tasks.googleapis.com/tasks/v1/lists/x/tasks", { method: "POST" })).rejects.toThrow(
      "Unexpected Google call: POST /tasks/v1/lists/x/tasks",
    );
  });

  it("serves_in_order", async () => {
    const g = new GoogleFake();
    g.queue("tasklists.list.ok");
    g.queue("tasklists.list.ok", { status: 404, body: { error: { code: 404, message: "Not Found" } } });
    const r1 = await g.fetch("https://tasks.googleapis.com/tasks/v1/users/@me/lists");
    const r2 = await g.fetch("https://tasks.googleapis.com/tasks/v1/users/@me/lists");
    expect(r1.status).toBe(200);
    expect(await r1.json()).toEqual(expect.objectContaining({ kind: "tasks#taskLists" }));
    expect(r2.status).toBe(404);
    expect(g.pending()).toBe(0);
  });

  it("records_calls", async () => {
    const g = new GoogleFake();
    g.queue("tasklists.list.ok");
    await g.fetch("https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=5", {
      headers: { Authorization: "Bearer abc" },
    });
    expect(g.calls).toHaveLength(1);
    expect(g.calls[0].url.searchParams.get("maxResults")).toBe("5");
    expect(g.calls[0].method).toBe("GET");
    expect(g.calls[0].headers.get("authorization")).toBe("Bearer abc");
  });
});
