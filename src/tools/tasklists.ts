import { z } from "zod";
import {
  listTaskLists,
  getTaskList,
  insertTaskList,
  updateTaskList,
  patchTaskList,
  deleteTaskList,
} from "../google/api.ts";
import { createLogger } from "../utils/logger.ts";
import { addReadableTimestamps } from "../utils/timestamp.ts";

const logger = createLogger({ component: "tools:tasklists" });

export function registerTaskListsTools(server: any, mcpAccessToken: string) {
  server.registerTool(
    "list_task_lists",
    {
      description:
        "Returns all the authenticated user's task lists. A user can have up to 2000 lists at a time.",
      inputSchema: {
        maxResults: z
          .number()
          .optional()
          .describe("Maximum number of task lists returned on one page. Default is 1000 (max allowed: 1000)."),
        pageToken: z
          .string()
          .optional()
          .describe("Token specifying the result page to return."),
      },
    },
    async (args: any) => {
      const { maxResults, pageToken } = args;
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
        taskListId: z.string().describe("Task list identifier."),
      },
    },
    async (args: any) => {
      const { taskListId } = args;
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
        title: z.string().describe("Title of the task list."),
      },
    },
    async (args: any) => {
      const { title } = args;
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
        taskListId: z.string().describe("Task list identifier."),
        title: z.string().describe("Title of the task list."),
      },
    },
    async (args: any) => {
      const { taskListId, title } = args;
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
        taskListId: z.string().describe("Task list identifier."),
        title: z.string().describe("Title of the task list."),
      },
    },
    async (args: any) => {
      const { taskListId, title } = args;
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
        taskListId: z.string().describe("Task list identifier."),
      },
    },
    async (args: any) => {
      const { taskListId } = args;
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
