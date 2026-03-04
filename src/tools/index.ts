import { registerTaskListsTools } from "./tasklists.ts";
import { registerTasksTools } from "./tasks.ts";

export function registerAllTools(server: any, mcpAccessToken: string) {
  registerTaskListsTools(server, mcpAccessToken);
  registerTasksTools(server, mcpAccessToken);
}
