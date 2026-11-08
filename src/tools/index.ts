import type { GoogleClient } from "../google/client.ts";
import { registerTaskListsTools } from "./tasklists.ts";
import { registerTasksTools } from "./tasks.ts";

export function registerAllTools(server: any, client: GoogleClient) {
  registerTaskListsTools(server, client);
  registerTasksTools(server, client);
}
