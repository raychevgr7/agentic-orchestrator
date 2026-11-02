import "dotenv/config";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { loadProjectMcpConfig } from "./config.js";
import { ProjectSource } from "./source.js";

const config = loadProjectMcpConfig();
const source = new ProjectSource(config.sourceRoot);
const app = express();
app.use(express.json({ limit: "1mb" }));
app.get("/health", (_request, response) => response.json({ status: "ok", service: "project-mcp" }));
app.post("/mcp", async (request, response) => {
  const server = createProjectMcpServer(source);
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
app.listen(config.port, config.bindHost, () => console.log(`project-mcp is listening on http://${config.bindHost}:${config.port}/mcp`));

export function createProjectMcpServer(project: ProjectSource): McpServer {
  const server = new McpServer({ name: "project-source", version: "0.1.0" });
  server.registerTool("project_list_tests", {
    title: "List project test files", description: "List test files in the configured local project. Read-only.",
    inputSchema: { maxResults: z.number().int().min(1).max(500).optional() },
  }, async ({ maxResults }) => json({ files: project.listTests(maxResults ?? 200) }));
  server.registerTool("project_search_source", {
    title: "Search project source", description: "Search supported source and test files in the configured local project. Read-only.",
    inputSchema: { query: z.string().min(2).max(100), maxResults: z.number().int().min(1).max(30).optional() },
  }, async ({ query, maxResults }) => json({ matches: project.search(query, maxResults ?? 12) }));
  server.registerTool("project_find_relevant_files", {
    title: "Find relevant project files", description: "Rank source and test files against task terms. Read-only.",
    inputSchema: { queries: z.array(z.string().min(2).max(100)).min(1).max(12), maxResults: z.number().int().min(1).max(20).optional() },
  }, async ({ queries, maxResults }) => json({ files: project.findRelevantFiles(queries, maxResults ?? 8) }));
  server.registerTool("project_read_source_excerpt", {
    title: "Read project source excerpt", description: "Read a bounded excerpt from one supported repository-relative source file. Read-only.",
    inputSchema: { path: z.string().min(1).max(500), startLine: z.number().int().min(1).optional(), maxLines: z.number().int().min(1).max(200).optional() },
  }, async ({ path, startLine, maxLines }) => json(project.readExcerpt(path, startLine ?? 1, maxLines ?? 120)));
  return server;
}

function json(data: unknown) { return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] }; }
