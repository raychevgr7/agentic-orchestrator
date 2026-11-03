export interface JenkinsMcpConfig {
  baseUrl: string;
  username: string;
  apiToken: string;
  allowedJobPaths: string[];
  port: number;
  bindHost: "127.0.0.1" | "0.0.0.0";
}
export function loadJenkinsMcpConfig(environment = process.env): JenkinsMcpConfig {
  const baseUrl = required(environment, "JENKINS_BASE_URL").replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error("JENKINS_BASE_URL must start with http:// or https://.");
  const port = Number.parseInt(environment.JENKINS_MCP_PORT ?? "3003", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("JENKINS_MCP_PORT must be a valid TCP port.");
  const bindHost = environment.MCP_BIND_HOST ?? "127.0.0.1";
  if (bindHost !== "127.0.0.1" && bindHost !== "0.0.0.0") throw new Error("MCP_BIND_HOST must be 127.0.0.1 or 0.0.0.0.");
  return {
    baseUrl,
    username: required(environment, "JENKINS_USERNAME"),
    apiToken: required(environment, "JENKINS_API_TOKEN"),
    allowedJobPaths: parseAllowedJobPaths(required(environment, "JENKINS_ALLOWED_JOB_PATHS")),
    port,
    bindHost,
  };
}

export function parseAllowedJobPaths(value: string): string[] {
  const paths = [...new Set(value.split(",").map(path => path.trim().replace(/\/+$/, "")).filter(Boolean))];
  if (!paths.length || paths.some(path => !isSafeJobPath(path))) {
    throw new Error("JENKINS_ALLOWED_JOB_PATHS must contain one or more relative Jenkins job paths.");
  }
  return paths;
}

function isSafeJobPath(path: string): boolean {
  return /^[A-Za-z0-9_./-]+$/.test(path) && !path.startsWith("/") && !path.split("/").some(segment => !segment || segment === "." || segment === "..");
}

function required(environment: NodeJS.ProcessEnv, name: string): string { const value = environment[name]?.trim(); if (!value) throw new Error(`Missing required environment variable: ${name}`); return value; }
