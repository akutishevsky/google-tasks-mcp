import { registerTaskListsTools } from "./tasklists.js";
import { registerTasksTools } from "./tasks.js";

export function registerAllTools(server: any, mcpAccessToken: string) {
  registerTaskListsTools(server, mcpAccessToken);
  registerTasksTools(server, mcpAccessToken);
}
