import type { AppDeps } from "../deps.ts";

/** ISSUER_URL when set, else the request's origin (upstream behaviour). */
export function issuer(deps: Pick<AppDeps, "config">, req: Request): string {
  return deps.config.issuerUrl ?? new URL(req.url).origin;
}

export const MCP_PATH = "/mcp";
export const PRM_PATH = "/.well-known/oauth-protected-resource";

export function resourceMetadataUrl(deps: Pick<AppDeps, "config">, req: Request): string {
  return `${issuer(deps, req)}${PRM_PATH}${MCP_PATH}`;
}
