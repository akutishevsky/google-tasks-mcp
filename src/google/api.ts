import { tokenStore } from "../auth/token-store.ts";
import { refreshGoogleToken } from "../auth/oauth.ts";
import { getOAuthConfig } from "../config.ts";
import { createLogger } from "../utils/logger.ts";

const logger = createLogger({ component: "google-api" });

const GOOGLE_TASKS_API_BASE = "https://tasks.googleapis.com/tasks/v1";

async function getValidAccessToken(mcpToken: string): Promise<string> {
  const tokenData = await tokenStore.getTokens(mcpToken);
  if (!tokenData) {
    throw new Error("Invalid or expired MCP token");
  }

  if (Date.now() >= tokenData.expiresAt - 60000) {
    logger.info("Access token expired, refreshing");
    const config = getOAuthConfig();
    const refreshed = await refreshGoogleToken(tokenData.googleRefreshToken, config);

    await tokenStore.updateTokens(mcpToken, {
      googleAccessToken: refreshed.accessToken,
      googleRefreshToken: refreshed.refreshToken,
      expiresAt: Date.now() + refreshed.expiresIn * 1000,
    });

    return refreshed.accessToken;
  }

  return tokenData.googleAccessToken;
}

async function makeGoogleRequest(
  mcpToken: string,
  endpoint: string,
  options?: RequestInit
): Promise<any> {
  const accessToken = await getValidAccessToken(mcpToken);

  const response = await fetch(`${GOOGLE_TASKS_API_BASE}${endpoint}`, {
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

  return response.json();
}

export async function listTaskLists(mcpToken: string, maxResults?: number, pageToken?: string) {
  const params = new URLSearchParams();
  if (maxResults) params.append("maxResults", maxResults.toString());
  if (pageToken) params.append("pageToken", pageToken);

  const query = params.toString() ? `?${params.toString()}` : "";
  return makeGoogleRequest(mcpToken, `/users/@me/lists${query}`);
}

export async function getTaskList(mcpToken: string, taskListId: string) {
  return makeGoogleRequest(mcpToken, `/users/@me/lists/${taskListId}`);
}

export async function insertTaskList(mcpToken: string, title: string) {
  return makeGoogleRequest(mcpToken, `/users/@me/lists`, {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

export async function updateTaskList(mcpToken: string, taskListId: string, title: string) {
  return makeGoogleRequest(mcpToken, `/users/@me/lists/${taskListId}`, {
    method: "PUT",
    body: JSON.stringify({ id: taskListId, title }),
  });
}

export async function patchTaskList(mcpToken: string, taskListId: string, updates: any) {
  return makeGoogleRequest(mcpToken, `/users/@me/lists/${taskListId}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export async function deleteTaskList(mcpToken: string, taskListId: string) {
  return makeGoogleRequest(mcpToken, `/users/@me/lists/${taskListId}`, {
    method: "DELETE",
  });
}

export async function listTasks(
  mcpToken: string,
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
  return makeGoogleRequest(mcpToken, `/lists/${taskListId}/tasks${query}`);
}

export async function getTask(mcpToken: string, taskListId: string, taskId: string) {
  return makeGoogleRequest(mcpToken, `/lists/${taskListId}/tasks/${taskId}`);
}

export async function insertTask(mcpToken: string, taskListId: string, task: any, parent?: string, previous?: string) {
  const params = new URLSearchParams();
  if (parent) params.append("parent", parent);
  if (previous) params.append("previous", previous);

  const query = params.toString() ? `?${params.toString()}` : "";
  return makeGoogleRequest(mcpToken, `/lists/${taskListId}/tasks${query}`, {
    method: "POST",
    body: JSON.stringify(task),
  });
}

export async function updateTask(mcpToken: string, taskListId: string, taskId: string, task: any) {
  return makeGoogleRequest(mcpToken, `/lists/${taskListId}/tasks/${taskId}`, {
    method: "PUT",
    body: JSON.stringify({ ...task, id: taskId }),
  });
}

export async function patchTask(mcpToken: string, taskListId: string, taskId: string, updates: any) {
  return makeGoogleRequest(mcpToken, `/lists/${taskListId}/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export async function deleteTask(mcpToken: string, taskListId: string, taskId: string) {
  return makeGoogleRequest(mcpToken, `/lists/${taskListId}/tasks/${taskId}`, {
    method: "DELETE",
  });
}

export async function clearTasks(mcpToken: string, taskListId: string) {
  return makeGoogleRequest(mcpToken, `/lists/${taskListId}/clear`, {
    method: "POST",
  });
}

export async function moveTask(
  mcpToken: string,
  taskListId: string,
  taskId: string,
  parent?: string,
  previous?: string
) {
  const params = new URLSearchParams();
  if (parent) params.append("parent", parent);
  if (previous) params.append("previous", previous);

  const query = params.toString() ? `?${params.toString()}` : "";
  return makeGoogleRequest(mcpToken, `/lists/${taskListId}/tasks/${taskId}/move${query}`, {
    method: "POST",
  });
}
