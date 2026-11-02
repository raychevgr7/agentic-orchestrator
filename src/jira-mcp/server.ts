import "dotenv/config";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { JiraClient } from "./client.js";
import { loadJiraConfig, type JiraConfig } from "./config.js";

export function createJiraMcpApp(config: JiraConfig, jira: JiraClient) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.get("/health", (_request, response) => response.json({ status: "ok", service: "jira-mcp" }));
  app.post("/mcp", async (request, response) => {
    const server = createJiraMcpServer(config, jira);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    response.on("close", () => void transport.close());
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      if (!response.headersSent) response.status(500).json({ error: "Unable to process MCP request." });
      console.error("MCP request failed:", error instanceof Error ? error.message : "Unknown error");
    }
  });
  return app;
}

function startJiraMcpServer(): void {
  const config = loadJiraConfig();
  createJiraMcpApp(config, new JiraClient(config)).listen(config.port, config.bindHost, () => console.log(`jira-mcp is listening on http://${config.bindHost}:${config.port}/mcp`));
}

if (process.argv[1] && /jira-mcp[\\/]server\.(?:ts|js)$/.test(process.argv[1])) startJiraMcpServer();

export function createJiraMcpServer(jiraConfig: JiraConfig, jiraClient: JiraClient): McpServer {
  const server = new McpServer({ name: "jira-readonly", version: "0.1.0" });
  const issueKey = z.string().regex(/^[A-Za-z][A-Za-z0-9]+-\d+$/, "Expected an issue key such as PROJECT-123.");
  server.registerTool("jira_get_issue", {
    title: "Get Jira issue", description: "Read an issue within the configured project scope. This tool never changes Jira.", inputSchema: { issueKey },
  }, async ({ issueKey: key }) => {
    const normalized = key.toUpperCase();
    assertAllowedProject(normalized, jiraConfig.allowedProjectKeys);
    return json(await jiraClient.getIssue(normalized));
  });
  server.registerTool("jira_search_issues", {
    title: "Search scoped Jira issues", description: "Search only the configured Jira projects using optional text and status filters. This tool never changes Jira.",
    inputSchema: { text: z.string().min(2).max(200).optional(), status: z.string().min(1).max(100).optional(), maxResults: z.number().int().min(1).max(100).optional() },
  }, async ({ text, status, maxResults }) => json(await jiraClient.searchIssues({ text, status, maxResults: maxResults ?? 50 })));
  server.registerTool("jira_get_attachment", {
    title: "Get Jira attachment", description: "Read one bounded attachment belonging to an issue within the configured scope. This tool never changes Jira.",
    inputSchema: { issueKey, attachmentId: z.string().min(1).max(100), maxBytes: z.number().int().min(1).max(5_000_000).optional() },
  }, async ({ issueKey: key, attachmentId, maxBytes }) => {
    const normalized = key.toUpperCase();
    assertAllowedProject(normalized, jiraConfig.allowedProjectKeys);
    return json(await jiraClient.getAttachment(normalized, attachmentId, maxBytes ?? 5_000_000));
  });
  return server;
}

function assertAllowedProject(issueKey: string, allowedProjectKeys: string[]): void {
  const projectKey = issueKey.split("-", 1)[0]!;
  if (!allowedProjectKeys.includes(projectKey)) throw new Error(`Issue ${issueKey} is outside the configured Jira project scope.`);
}
function json(data: unknown) { return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] }; }
