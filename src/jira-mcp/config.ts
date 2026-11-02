export interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  allowedProjectKeys: string[];
  port: number;
  bindHost: "127.0.0.1" | "0.0.0.0";
}

export function loadJiraConfig(environment = process.env): JiraConfig {
  const baseUrl = required(environment, "JIRA_BASE_URL").replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error("JIRA_BASE_URL must start with http:// or https://.");
  const allowedProjectKeys = required(environment, "JIRA_ALLOWED_PROJECT_KEYS")
    .split(",").map((key) => key.trim().toUpperCase()).filter(Boolean);
  if (!allowedProjectKeys.length || allowedProjectKeys.some((key) => !/^[A-Z][A-Z0-9]+$/.test(key))) {
    throw new Error("JIRA_ALLOWED_PROJECT_KEYS must contain comma-separated Jira project keys.");
  }
  return {
    baseUrl,
    email: required(environment, "JIRA_EMAIL"),
    apiToken: required(environment, "JIRA_API_TOKEN"),
    allowedProjectKeys,
    port: boundedPort(environment.JIRA_MCP_PORT),
    bindHost: bindHost(environment.MCP_BIND_HOST),
  };
}

function bindHost(value: string | undefined): "127.0.0.1" | "0.0.0.0" {
  const host = value ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "0.0.0.0") throw new Error("MCP_BIND_HOST must be 127.0.0.1 or 0.0.0.0.");
  return host;
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function boundedPort(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "3001", 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) throw new Error("JIRA_MCP_PORT must be a valid TCP port.");
  return parsed;
}
