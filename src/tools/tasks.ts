import type { GoogleClient } from "../google/client.ts";
import { z } from "zod";
import {
  listTasks,
  getTask,
  insertTask,
  updateTask,
  patchTask,
  deleteTask,
  clearTasks,
  moveTask,
} from "../google/api.ts";
import { createLogger } from "../utils/logger.ts";
import { addReadableTimestamps } from "../utils/timestamp.ts";
import {
  addDueTimeFields,
  DUE_TIME_PATTERN,
  DUE_TIME_QUALIFIERS,
  normalizeDueDate,
  withDueTime,
} from "../utils/due.ts";

const logger = createLogger({ component: "tools:tasks" });

// Google keeps only the calendar date of `due`; the time of day is recorded
// as text at the end of the title. See docs/specs/2026-10-23-due-time-design.md.
const dueInputSchema = {
  due: z
    .string()
    .optional()
    .describe(
      "Due date as YYYY-MM-DD in the user's local calendar (resolve words like \"tomorrow\" in the user's timezone first). Google Tasks keeps only the date; use dueTime for the time of day.",
    ),
  dueTime: z
    .string()
    .regex(new RegExp(`^(|${DUE_TIME_PATTERN.source.slice(1, -1)})$`))
    .optional()
    .describe(
      "Time of day the task is due, 24-hour HH:MM (e.g. \"15:30\"). Google's API cannot store a time, so the server records it as text at the end of the title, e.g. \"Call dentist (at 3:30 PM)\". Pass \"\" to remove an existing time.",
    ),
  dueTimeQualifier: z
    .enum(DUE_TIME_QUALIFIERS as [string, ...string[]])
    .optional()
    .describe("Word before the time in the title: \"at\" (default), \"before\" or \"by\". Only used with dueTime."),
};

// Turns tool arguments into the Google task payload: normalises `due` and
// folds `dueTime`/`dueTimeQualifier` into the title. Fetches the current task
// only when a time is given without a title (update/patch). For `update`
// (Google PUT, a full replacement) the fetched task is merged under the
// caller's fields so an unmentioned due date or notes are not wiped.
async function toGoogleTask(
  client: GoogleClient,
  taskListId: string,
  taskId: string | undefined,
  args: any,
  mode: "insert" | "update" | "patch",
) {
  const { dueTime, dueTimeQualifier, ...task } = args;
  if (typeof task.due === "string") task.due = normalizeDueDate(task.due);
  if (typeof dueTime === "string") {
    let base = typeof task.title === "string" ? task.title : "";
    if (typeof task.title !== "string" && taskId) {
      const current = await getTask(client, taskListId, taskId);
      base = current.title ?? "";
      if (mode === "update") Object.assign(task, { ...current, ...task });
    }
    task.title = withDueTime(base, dueTime, dueTimeQualifier);
  }
  return task;
}

const TITLE_DESCRIPTION =
  "Title of the task. A due time is kept as a trailing suffix like \"(at 3:30 PM)\"; when renaming, keep that suffix or pass dueTime again.";

const presentTask = (result: unknown) => addDueTimeFields(addReadableTimestamps(result));

export function registerTasksTools(server: any, client: GoogleClient) {
  server.registerTool(
    "list_tasks",
    {
      description: "Returns all tasks in the specified task list. IMPORTANT: To see completed tasks from the web UI or mobile apps, you MUST set both showCompleted=true AND showHidden=true. Google Tasks API does not expose future instances of recurring tasks. When filtering by due date, only the current instance of recurring tasks will be shown, not future occurrences.",
      inputSchema: {
        taskListId: z.string().describe("Task list identifier."),
        completedMax: z
          .string()
          .optional()
          .describe("Upper bound for a task's completion date (RFC 3339 timestamp) to filter by."),
        completedMin: z
          .string()
          .optional()
          .describe("Lower bound for a task's completion date (RFC 3339 timestamp) to filter by."),
        dueMax: z
          .string()
          .optional()
          .describe("Upper bound for a task's due date (RFC 3339 timestamp) to filter by. Google compares against midnight UTC of the due date."),
        dueMin: z
          .string()
          .optional()
          .describe("Lower bound for a task's due date (RFC 3339 timestamp) to filter by. Google compares against midnight UTC of the due date."),
        maxResults: z
          .number()
          .optional()
          .describe("Maximum number of tasks returned on one page."),
        pageToken: z
          .string()
          .optional()
          .describe("Token specifying the result page to return."),
        showCompleted: z
          .boolean()
          .optional()
          .describe("Flag indicating whether completed tasks are returned in the result. Default is true."),
        showDeleted: z
          .boolean()
          .optional()
          .describe("Flag indicating whether deleted tasks are returned in the result. Default is false."),
        showHidden: z
          .boolean()
          .optional()
          .describe("Flag indicating whether hidden tasks are returned in the result. IMPORTANT: Must be true to show tasks completed in the web UI or mobile apps. Default is false."),
        updatedMin: z
          .string()
          .optional()
          .describe("Lower bound for a task's last modification time (RFC 3339 timestamp) to filter by."),
      },
    },
    async (args: any) => {
      logger.info("Tool invoked: list_tasks");
      try {
        const { taskListId, dueMin, dueMax, showCompleted, showHidden, ...options } = args;
        const result = await listTasks(client, taskListId, { dueMin, dueMax, showCompleted, showHidden, ...options });
        const processedData = presentTask(result);

        let responseText = JSON.stringify(processedData, null, 2);
        const warnings: string[] = [];

        // Add warning if date filters are used
        if (dueMin || dueMax) {
          warnings.push("⚠️ RECURRING TASKS: Google Tasks API does not support recurring tasks. This query only returns the CURRENT instance of any recurring tasks. Future occurrences of recurring tasks will not appear in these results, even if they fall within the specified date range.");
        }

        // Add warning if showCompleted is true but showHidden is not
        if (showCompleted === true && showHidden !== true) {
          warnings.push("⚠️ COMPLETED TASKS: You set showCompleted=true but showHidden is not true. Tasks completed in the web UI or mobile apps will NOT be visible. To see all completed tasks, you must set BOTH showCompleted=true AND showHidden=true.");
        }

        if (warnings.length > 0) {
          responseText = responseText + "\n\n" + warnings.join("\n\n");
        }

        return {
          content: [
            {
              type: "text",
              text: responseText,
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
        taskListId: z.string().describe("Task list identifier."),
        taskId: z.string().describe("Task identifier."),
      },
    },
    async (args: any) => {
      const { taskListId, taskId } = args;
      logger.info("Tool invoked: get_task");
      try {
        const result = await getTask(client, taskListId, taskId);
        const processedData = presentTask(result);

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
        taskListId: z.string().describe("Task list identifier."),
        title: z.string().describe(TITLE_DESCRIPTION),
        notes: z.string().optional().describe("Notes describing the task."),
        ...dueInputSchema,
        parent: z
          .string()
          .optional()
          .describe("Parent task identifier. If specified, the task is created as a subtask."),
        previous: z
          .string()
          .optional()
          .describe("Previous sibling task identifier. If specified, the task is created at the position after this sibling."),
      },
    },
    async (args: any) => {
      logger.info("Tool invoked: insert_task");
      try {
        const { taskListId, parent, previous, ...rest } = args;
        const task = await toGoogleTask(client, taskListId, undefined, rest, "insert");
        const result = await insertTask(client, taskListId, task, parent, previous);
        const processedData = presentTask(result);

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
        taskListId: z.string().describe("Task list identifier."),
        taskId: z.string().describe("Task identifier."),
        title: z.string().optional().describe(TITLE_DESCRIPTION),
        notes: z.string().optional().describe("Notes describing the task."),
        status: z
          .enum(["needsAction", "completed"])
          .optional()
          .describe("Status of the task. Either 'needsAction' or 'completed'."),
        ...dueInputSchema,
        completed: z
          .string()
          .optional()
          .describe("Completion date of the task (RFC 3339 timestamp). Only set when status is 'completed'."),
      },
    },
    async (args: any) => {
      logger.info("Tool invoked: update_task");
      try {
        const { taskListId, taskId, ...rest } = args;
        const task = await toGoogleTask(client, taskListId, taskId, rest, "update");
        const result = await updateTask(client, taskListId, taskId, task);
        const processedData = presentTask(result);

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
        taskListId: z.string().describe("Task list identifier."),
        taskId: z.string().describe("Task identifier."),
        title: z.string().optional().describe(TITLE_DESCRIPTION),
        notes: z.string().optional().describe("Notes describing the task."),
        status: z
          .enum(["needsAction", "completed"])
          .optional()
          .describe("Status of the task. Either 'needsAction' or 'completed'."),
        ...dueInputSchema,
        completed: z
          .string()
          .optional()
          .describe("Completion date of the task (RFC 3339 timestamp). Only set when status is 'completed'."),
      },
    },
    async (args: any) => {
      logger.info("Tool invoked: patch_task");
      try {
        const { taskListId, taskId, ...rest } = args;
        const updates = await toGoogleTask(client, taskListId, taskId, rest, "patch");
        const result = await patchTask(client, taskListId, taskId, updates);
        const processedData = presentTask(result);

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
        taskListId: z.string().describe("Task list identifier."),
        taskId: z.string().describe("Task identifier."),
      },
    },
    async (args: any) => {
      const { taskListId, taskId } = args;
      logger.info("Tool invoked: delete_task");
      try {
        await deleteTask(client, taskListId, taskId);

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
        taskListId: z.string().describe("Task list identifier."),
      },
    },
    async (args: any) => {
      const { taskListId } = args;
      logger.info("Tool invoked: clear_completed_tasks");
      try {
        await clearTasks(client, taskListId);

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
        taskListId: z.string().describe("Task list identifier."),
        taskId: z.string().describe("Task identifier."),
        parent: z
          .string()
          .optional()
          .describe("New parent task identifier. If not specified, the task is moved to the top level."),
        previous: z
          .string()
          .optional()
          .describe("New previous sibling task identifier. If not specified, the task is moved to the first position among its siblings."),
      },
    },
    async (args: any) => {
      const { taskListId, taskId, parent, previous } = args;
      logger.info("Tool invoked: move_task");
      try {
        const result = await moveTask(client, taskListId, taskId, parent, previous);
        const processedData = presentTask(result);

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
