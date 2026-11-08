import type { GoogleClient } from "./client.ts";
import { createLogger } from "../utils/logger.ts";

const logger = createLogger({ component: "google-api" });

const GOOGLE_TASKS_API_BASE = "https://tasks.googleapis.com/tasks/v1";

async function makeGoogleRequest(
  client: GoogleClient,
  endpoint: string,
  options?: RequestInit
): Promise<any> {
  const accessToken = await client.getAccessToken();

  const response = await client.fetch(`${GOOGLE_TASKS_API_BASE}${endpoint}`, {
    ...options,
    headers: {
      ...options?.headers,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const error = await response.text();
    logger.error("Google API request failed", { status: response.status, endpoint });
    throw new Error(`Google API error: ${response.status} - ${error}`);
  }

  // Deletes and clear return 204 with no body.
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export function listTaskLists(client: GoogleClient, maxResults?: number, pageToken?: string) {
  const params = new URLSearchParams();
  if (maxResults) params.append("maxResults", maxResults.toString());
  if (pageToken) params.append("pageToken", pageToken);

  const query = params.toString() ? `?${params.toString()}` : "";
  return makeGoogleRequest(client, `/users/@me/lists${query}`);
}

export function getTaskList(client: GoogleClient, taskListId: string) {
  return makeGoogleRequest(client, `/users/@me/lists/${taskListId}`);
}

export function insertTaskList(client: GoogleClient, title: string) {
  return makeGoogleRequest(client, `/users/@me/lists`, {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

export function updateTaskList(client: GoogleClient, taskListId: string, title: string) {
  return makeGoogleRequest(client, `/users/@me/lists/${taskListId}`, {
    method: "PUT",
    body: JSON.stringify({ id: taskListId, title }),
  });
}

export function patchTaskList(client: GoogleClient, taskListId: string, updates: any) {
  return makeGoogleRequest(client, `/users/@me/lists/${taskListId}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export function deleteTaskList(client: GoogleClient, taskListId: string) {
  return makeGoogleRequest(client, `/users/@me/lists/${taskListId}`, {
    method: "DELETE",
  });
}

export function listTasks(
  client: GoogleClient,
  taskListId: string,
  options?: {
    completedMax?: string;
    completedMin?: string;
    dueMax?: string;
    dueMin?: string;
    maxResults?: number;
    pageToken?: string;
    showCompleted?: boolean;
    showDeleted?: boolean;
    showHidden?: boolean;
    updatedMin?: string;
  }
) {
  const params = new URLSearchParams();
  if (options?.completedMax) params.append("completedMax", options.completedMax);
  if (options?.completedMin) params.append("completedMin", options.completedMin);
  if (options?.dueMax) params.append("dueMax", options.dueMax);
  if (options?.dueMin) params.append("dueMin", options.dueMin);
  if (options?.maxResults) params.append("maxResults", options.maxResults.toString());
  if (options?.pageToken) params.append("pageToken", options.pageToken);
  if (options?.showCompleted !== undefined) params.append("showCompleted", options.showCompleted.toString());
  if (options?.showDeleted !== undefined) params.append("showDeleted", options.showDeleted.toString());
  if (options?.showHidden !== undefined) params.append("showHidden", options.showHidden.toString());
  if (options?.updatedMin) params.append("updatedMin", options.updatedMin);

  const query = params.toString() ? `?${params.toString()}` : "";
  return makeGoogleRequest(client, `/lists/${taskListId}/tasks${query}`);
}

export function getTask(client: GoogleClient, taskListId: string, taskId: string) {
  return makeGoogleRequest(client, `/lists/${taskListId}/tasks/${taskId}`);
}

export function insertTask(client: GoogleClient, taskListId: string, task: any, parent?: string, previous?: string) {
  const params = new URLSearchParams();
  if (parent) params.append("parent", parent);
  if (previous) params.append("previous", previous);

  const query = params.toString() ? `?${params.toString()}` : "";
  return makeGoogleRequest(client, `/lists/${taskListId}/tasks${query}`, {
    method: "POST",
    body: JSON.stringify(task),
  });
}

export function updateTask(client: GoogleClient, taskListId: string, taskId: string, task: any) {
  return makeGoogleRequest(client, `/lists/${taskListId}/tasks/${taskId}`, {
    method: "PUT",
    body: JSON.stringify({ ...task, id: taskId }),
  });
}

export function patchTask(client: GoogleClient, taskListId: string, taskId: string, updates: any) {
  return makeGoogleRequest(client, `/lists/${taskListId}/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export function deleteTask(client: GoogleClient, taskListId: string, taskId: string) {
  return makeGoogleRequest(client, `/lists/${taskListId}/tasks/${taskId}`, {
    method: "DELETE",
  });
}

export function clearTasks(client: GoogleClient, taskListId: string) {
  return makeGoogleRequest(client, `/lists/${taskListId}/clear`, {
    method: "POST",
  });
}

export function moveTask(
  client: GoogleClient,
  taskListId: string,
  taskId: string,
  parent?: string,
  previous?: string
) {
  const params = new URLSearchParams();
  if (parent) params.append("parent", parent);
  if (previous) params.append("previous", previous);

  const query = params.toString() ? `?${params.toString()}` : "";
  return makeGoogleRequest(client, `/lists/${taskListId}/tasks/${taskId}/move${query}`, {
    method: "POST",
  });
}
