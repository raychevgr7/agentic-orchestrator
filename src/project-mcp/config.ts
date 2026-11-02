import { resolve } from "node:path";

export interface ProjectMcpConfig {
  sourceRoot: string;
  port: number;
}

export function loadProjectMcpConfig(environment = process.env): ProjectMcpConfig {
  const sourceRoot = environment.PROJECT_SOURCE_ROOT?.trim();
  if (!sourceRoot) throw new Error("PROJECT_SOURCE_ROOT is required and must point to a local source repository.");
  return {
    sourceRoot: resolve(sourceRoot),
    port: boundedPort(environment.PROJECT_MCP_PORT),
  };
}

function boundedPort(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "3002", 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) throw new Error("PROJECT_MCP_PORT must be a valid TCP port.");
  return parsed;
}
