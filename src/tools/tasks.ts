import {
  listTasks,
  getTask,
  insertTask,
  updateTask,
  patchTask,
  deleteTask,
  clearTasks,
  moveTask,
} from "../google/api.js";
import { createLogger } from "../utils/logger.js";
import { addReadableTimestamps } from "../utils/timestamp.js";

const logger = createLogger({ component: "tools:tasks" });

export function registerTasksTools(server: any, mcpAccessToken: string) {
  server.registerTool(
    "list_tasks",
    {
      description: "Returns all tasks in the specified task list.",
      inputSchema: {
        type: "object",
        properties: {
          taskListId: {
            type: "string",
            description: "Task list identifier.",
          },
          completedMax: {
            type: "string",
            description: "Upper bound for a task's completion date (RFC 3339 timestamp) to filter by.",
          },
          completedMin: {
            type: "string",
            description: "Lower bound for a task's completion date (RFC 3339 timestamp) to filter by.",
          },
          dueMax: {
            type: "string",
            description: "Upper bound for a task's due date (RFC 3339 timestamp) to filter by.",
          },
          dueMin: {
            type: "string",
            description: "Lower bound for a task's due date (RFC 3339 timestamp) to filter by.",
          },
          maxResults: {
            type: "number",
            description: "Maximum number of tasks returned on one page.",
          },
          pageToken: {
            type: "string",
            description: "Token specifying the result page to return.",
          },
          showCompleted: {
            type: "boolean",
            description: "Flag indicating whether completed tasks are returned in the result. Default is true.",
          },
          showDeleted: {
            type: "boolean",
            description: "Flag indicating whether deleted tasks are returned in the result. Default is false.",
          },
          showHidden: {
            type: "boolean",
            description: "Flag indicating whether hidden tasks are returned in the result. Default is false.",
          },
          updatedMin: {
            type: "string",
            description: "Lower bound for a task's last modification time (RFC 3339 timestamp) to filter by.",
          },
        },
        required: ["taskListId"],
      },
    },
    async (params: any) => {
      logger.info("Tool invoked: list_tasks");
      try {
        const { taskListId, ...options } = params;
        const result = await listTasks(mcpAccessToken, taskListId, options);
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
        logger.error("Tool error: list_tasks");
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
    "get_task",
    {
      description: "Returns the specified task.",
      inputSchema: {
        type: "object",
        properties: {
          taskListId: {
            type: "string",
            description: "Task list identifier.",
          },
          taskId: {
            type: "string",
            description: "Task identifier.",
          },
        },
        required: ["taskListId", "taskId"],
      },
    },
    async ({ taskListId, taskId }: { taskListId: string; taskId: string }) => {
      logger.info("Tool invoked: get_task");
      try {
        const result = await getTask(mcpAccessToken, taskListId, taskId);
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
        logger.error("Tool error: get_task");
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
    "insert_task",
    {
      description: "Creates a new task on the specified task list.",
      inputSchema: {
        type: "object",
        properties: {
          taskListId: {
            type: "string",
            description: "Task list identifier.",
          },
          title: {
            type: "string",
            description: "Title of the task.",
          },
          notes: {
            type: "string",
            description: "Notes describing the task.",
          },
          due: {
            type: "string",
            description: "Due date of the task (RFC 3339 timestamp, e.g., '2025-01-15T00:00:00.000Z').",
          },
          parent: {
            type: "string",
            description: "Parent task identifier. If specified, the task is created as a subtask.",
          },
          previous: {
            type: "string",
            description: "Previous sibling task identifier. If specified, the task is created at the position after this sibling.",
          },
        },
        required: ["taskListId", "title"],
      },
    },
    async (params: any) => {
      logger.info("Tool invoked: insert_task");
      try {
        const { taskListId, parent, previous, ...task } = params;
        const result = await insertTask(mcpAccessToken, taskListId, task, parent, previous);
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
        logger.error("Tool error: insert_task");
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
    "update_task",
    {
      description: "Updates the specified task. This method supports full update.",
      inputSchema: {
        type: "object",
        properties: {
          taskListId: {
            type: "string",
            description: "Task list identifier.",
          },
          taskId: {
            type: "string",
            description: "Task identifier.",
          },
          title: {
            type: "string",
            description: "Title of the task.",
          },
          notes: {
            type: "string",
            description: "Notes describing the task.",
          },
          status: {
            type: "string",
            description: "Status of the task. Either 'needsAction' or 'completed'.",
            enum: ["needsAction", "completed"],
          },
          due: {
            type: "string",
            description: "Due date of the task (RFC 3339 timestamp, e.g., '2025-01-15T00:00:00.000Z').",
          },
          completed: {
            type: "string",
            description: "Completion date of the task (RFC 3339 timestamp). Only set when status is 'completed'.",
          },
        },
        required: ["taskListId", "taskId"],
      },
    },
    async (params: any) => {
      logger.info("Tool invoked: update_task");
      try {
        const { taskListId, taskId, ...task } = params;
        const result = await updateTask(mcpAccessToken, taskListId, taskId, task);
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
        logger.error("Tool error: update_task");
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
    "patch_task",
    {
      description: "Updates the specified task. This method supports patch semantics.",
      inputSchema: {
        type: "object",
        properties: {
          taskListId: {
            type: "string",
            description: "Task list identifier.",
          },
          taskId: {
            type: "string",
            description: "Task identifier.",
          },
          title: {
            type: "string",
            description: "Title of the task.",
          },
          notes: {
            type: "string",
            description: "Notes describing the task.",
          },
          status: {
            type: "string",
            description: "Status of the task. Either 'needsAction' or 'completed'.",
            enum: ["needsAction", "completed"],
          },
          due: {
            type: "string",
            description: "Due date of the task (RFC 3339 timestamp, e.g., '2025-01-15T00:00:00.000Z').",
          },
          completed: {
            type: "string",
            description: "Completion date of the task (RFC 3339 timestamp). Only set when status is 'completed'.",
          },
        },
        required: ["taskListId", "taskId"],
      },
    },
    async (params: any) => {
      logger.info("Tool invoked: patch_task");
      try {
        const { taskListId, taskId, ...updates } = params;
        const result = await patchTask(mcpAccessToken, taskListId, taskId, updates);
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
        logger.error("Tool error: patch_task");
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
    "delete_task",
    {
      description: "Deletes the specified task from the task list.",
      inputSchema: {
        type: "object",
        properties: {
          taskListId: {
            type: "string",
            description: "Task list identifier.",
          },
          taskId: {
            type: "string",
            description: "Task identifier.",
          },
        },
        required: ["taskListId", "taskId"],
      },
    },
    async ({ taskListId, taskId }: { taskListId: string; taskId: string }) => {
      logger.info("Tool invoked: delete_task");
      try {
        await deleteTask(mcpAccessToken, taskListId, taskId);

        return {
          content: [
            {
              type: "text",
              text: "Task deleted successfully",
            },
          ],
        };
      } catch (error) {
        logger.error("Tool error: delete_task");
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
    "clear_completed_tasks",
    {
      description: "Clears all completed tasks from the specified task list. The affected tasks will be marked as 'hidden' and no longer be returned by default when retrieving all tasks for a task list.",
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
      logger.info("Tool invoked: clear_completed_tasks");
      try {
        await clearTasks(mcpAccessToken, taskListId);

        return {
          content: [
            {
              type: "text",
              text: "Completed tasks cleared successfully",
            },
          ],
        };
      } catch (error) {
        logger.error("Tool error: clear_completed_tasks");
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
    "move_task",
    {
      description: "Moves the specified task to another position in the destination task list. This can be used to change a task's parent task or position among its sibling tasks.",
      inputSchema: {
        type: "object",
        properties: {
          taskListId: {
            type: "string",
            description: "Task list identifier.",
          },
          taskId: {
            type: "string",
            description: "Task identifier.",
          },
          parent: {
            type: "string",
            description: "New parent task identifier. If not specified, the task is moved to the top level.",
          },
          previous: {
            type: "string",
            description: "New previous sibling task identifier. If not specified, the task is moved to the first position among its siblings.",
          },
        },
        required: ["taskListId", "taskId"],
      },
    },
    async ({ taskListId, taskId, parent, previous }: any) => {
      logger.info("Tool invoked: move_task");
      try {
        const result = await moveTask(mcpAccessToken, taskListId, taskId, parent, previous);
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
        logger.error("Tool error: move_task");
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
