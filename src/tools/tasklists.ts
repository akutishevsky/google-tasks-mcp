import {
  listTaskLists,
  getTaskList,
  insertTaskList,
  updateTaskList,
  patchTaskList,
  deleteTaskList,
} from "../google/api.js";
import { createLogger } from "../utils/logger.js";
import { addReadableTimestamps } from "../utils/timestamp.js";

const logger = createLogger({ component: "tools:tasklists" });

export function registerTaskListsTools(server: any, mcpAccessToken: string) {
  server.registerTool(
    "list_task_lists",
    {
      description:
        "Returns all the authenticated user's task lists. A user can have up to 2000 lists at a time.",
      inputSchema: {
        type: "object",
        properties: {
          maxResults: {
            type: "number",
            description: "Maximum number of task lists returned on one page. Default is 1000 (max allowed: 1000).",
          },
          pageToken: {
            type: "string",
            description: "Token specifying the result page to return.",
          },
        },
      },
    },
    async ({ maxResults, pageToken }: { maxResults?: number; pageToken?: string }) => {
      logger.info("Tool invoked: list_task_lists");
      try {
        const result = await listTaskLists(mcpAccessToken, maxResults, pageToken);
        const processedData = addReadableTimestamps(result);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(processedData, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error("Tool error: list_task_lists");
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "get_task_list",
    {
      description: "Returns the authenticated user's specified task list.",
      inputSchema: {
        type: "object",
        properties: {
          taskListId: {
            type: "string",
            description: "Task list identifier.",
          },
        },
        required: ["taskListId"],
      },
    },
    async ({ taskListId }: { taskListId: string }) => {
      logger.info("Tool invoked: get_task_list");
      try {
        const result = await getTaskList(mcpAccessToken, taskListId);
        const processedData = addReadableTimestamps(result);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(processedData, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error("Tool error: get_task_list");
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "insert_task_list",
    {
      description: "Creates a new task list and adds it to the authenticated user's task lists.",
      inputSchema: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Title of the task list.",
          },
        },
        required: ["title"],
      },
    },
    async ({ title }: { title: string }) => {
      logger.info("Tool invoked: insert_task_list");
      try {
        const result = await insertTaskList(mcpAccessToken, title);
        const processedData = addReadableTimestamps(result);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(processedData, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error("Tool error: insert_task_list");
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "update_task_list",
    {
      description: "Updates the authenticated user's specified task list. This method supports full update.",
      inputSchema: {
        type: "object",
        properties: {
          taskListId: {
            type: "string",
            description: "Task list identifier.",
          },
          title: {
            type: "string",
            description: "Title of the task list.",
          },
        },
        required: ["taskListId", "title"],
      },
    },
    async ({ taskListId, title }: { taskListId: string; title: string }) => {
      logger.info("Tool invoked: update_task_list");
      try {
        const result = await updateTaskList(mcpAccessToken, taskListId, title);
        const processedData = addReadableTimestamps(result);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(processedData, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error("Tool error: update_task_list");
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "patch_task_list",
    {
      description: "Updates the authenticated user's specified task list. This method supports patch semantics.",
      inputSchema: {
        type: "object",
        properties: {
          taskListId: {
            type: "string",
            description: "Task list identifier.",
          },
          title: {
            type: "string",
            description: "Title of the task list.",
          },
        },
        required: ["taskListId", "title"],
      },
    },
    async ({ taskListId, title }: { taskListId: string; title: string }) => {
      logger.info("Tool invoked: patch_task_list");
      try {
        const result = await patchTaskList(mcpAccessToken, taskListId, { title });
        const processedData = addReadableTimestamps(result);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(processedData, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error("Tool error: patch_task_list");
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "delete_task_list",
    {
      description: "Deletes the authenticated user's specified task list.",
      inputSchema: {
        type: "object",
        properties: {
          taskListId: {
            type: "string",
            description: "Task list identifier.",
          },
        },
        required: ["taskListId"],
      },
    },
    async ({ taskListId }: { taskListId: string }) => {
      logger.info("Tool invoked: delete_task_list");
      try {
        await deleteTaskList(mcpAccessToken, taskListId);

        return {
          content: [
            {
              type: "text",
              text: "Task list deleted successfully",
            },
          ],
        };
      } catch (error) {
        logger.error("Tool error: delete_task_list");
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
