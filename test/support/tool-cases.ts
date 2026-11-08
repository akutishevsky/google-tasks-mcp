// One row per tool: arguments, the fixture endpoint it hits, and the Google
// request it must make. Shared by characterisation and tool scenarios.
export type ToolCase = {
  tool: string;
  args: Record<string, unknown>;
  endpoint: string; // fixture prefix, e.g. "tasks.get" → tasks.get.ok / tasks.get.err
  method: string;
  path: string; // expected decoded pathname
  query?: Record<string, string>;
};

const L = "PLANTED_LIST_1";
const T = "PLANTED_TASK_1";

export const TOOL_CASES: ToolCase[] = [
  { tool: "list_task_lists", args: { maxResults: 10 }, endpoint: "tasklists.list", method: "GET", path: "/tasks/v1/users/@me/lists", query: { maxResults: "10" } },
  { tool: "get_task_list", args: { taskListId: L }, endpoint: "tasklists.get", method: "GET", path: `/tasks/v1/users/@me/lists/${L}` },
  { tool: "insert_task_list", args: { title: "New list" }, endpoint: "tasklists.insert", method: "POST", path: "/tasks/v1/users/@me/lists" },
  { tool: "update_task_list", args: { taskListId: L, title: "Renamed" }, endpoint: "tasklists.update", method: "PUT", path: `/tasks/v1/users/@me/lists/${L}` },
  { tool: "patch_task_list", args: { taskListId: L, title: "Patched" }, endpoint: "tasklists.patch", method: "PATCH", path: `/tasks/v1/users/@me/lists/${L}` },
  { tool: "delete_task_list", args: { taskListId: L }, endpoint: "tasklists.delete", method: "DELETE", path: `/tasks/v1/users/@me/lists/${L}` },
  { tool: "list_tasks", args: { taskListId: L, showCompleted: true }, endpoint: "tasks.list", method: "GET", path: `/tasks/v1/lists/${L}/tasks`, query: { showCompleted: "true" } },
  { tool: "get_task", args: { taskListId: L, taskId: T }, endpoint: "tasks.get", method: "GET", path: `/tasks/v1/lists/${L}/tasks/${T}` },
  { tool: "insert_task", args: { taskListId: L, title: "Inserted", due: "2026-10-20T00:00:00.000Z" }, endpoint: "tasks.insert", method: "POST", path: `/tasks/v1/lists/${L}/tasks` },
  { tool: "update_task", args: { taskListId: L, taskId: T, title: "Updated" }, endpoint: "tasks.update", method: "PUT", path: `/tasks/v1/lists/${L}/tasks/${T}` },
  { tool: "patch_task", args: { taskListId: L, taskId: T, title: "Patched" }, endpoint: "tasks.patch", method: "PATCH", path: `/tasks/v1/lists/${L}/tasks/${T}` },
  { tool: "delete_task", args: { taskListId: L, taskId: T }, endpoint: "tasks.delete", method: "DELETE", path: `/tasks/v1/lists/${L}/tasks/${T}` },
  { tool: "clear_completed_tasks", args: { taskListId: L }, endpoint: "tasks.clear", method: "POST", path: `/tasks/v1/lists/${L}/clear` },
  { tool: "move_task", args: { taskListId: L, taskId: T, parent: "PLANTED_TASK_2" }, endpoint: "tasks.move", method: "POST", path: `/tasks/v1/lists/${L}/tasks/${T}/move`, query: { parent: "PLANTED_TASK_2" } },
];
