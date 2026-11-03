import "dotenv/config";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { JenkinsCiProvider } from "../ci/jenkins-provider.js";
import type { CiProvider } from "../ci/provider.js";
import { loadJenkinsMcpConfig, type JenkinsMcpConfig } from "./config.js";

export function createJenkinsMcpApp(provider: CiProvider, config: Pick<JenkinsMcpConfig, "allowedJobPaths">) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.get("/health", (_q, r) => r.json({ status: "ok", service: "jenkins-mcp" }));
  app.post("/mcp", async (q, r) => {
    const server = createJenkinsMcpServer(provider, config);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    r.on("close", () => void transport.close());
    try { await server.connect(transport); await transport.handleRequest(q, r, q.body); }
    catch { if (!r.headersSent) r.status(500).json({ error: "Unable to process MCP request." }); }
  });
  return app;
}

export function createJenkinsMcpServer(provider: CiProvider, config: Pick<JenkinsMcpConfig, "allowedJobPaths">): McpServer {
  const server = new McpServer({ name: "jenkins-readonly", version: "0.1.0" });
  const jobPath = z.string().min(1).max(400);
  const buildNumber = z.number().int().positive();
  const report = async (requestedJobPath: string, requestedBuildNumber: number) => {
    if (!config.allowedJobPaths.includes(requestedJobPath)) throw new Error("Jenkins job path is not in JENKINS_ALLOWED_JOB_PATHS.");
    return await provider.getBuild(`${requestedJobPath}/${requestedBuildNumber}`);
  };
  const inputSchema = { jobPath, buildNumber };
  server.registerTool("jenkins_get_build", { title: "Get Jenkins build", description: "Read metadata and test summary for an allowlisted Jenkins job. Console output is available only through jenkins_get_console_excerpt.", inputSchema }, async input => {
    const { logs: _logs, ...build } = await report(input.jobPath, input.buildNumber);
    return json(build);
  });
  server.registerTool("jenkins_get_console_excerpt", { title: "Get sanitized Jenkins console excerpt", description: "Read bounded, sanitized console output for an allowlisted Jenkins job.", inputSchema }, async input => {
    const value = await report(input.jobPath, input.buildNumber);
    return json({ buildUrl: value.buildUrl, status: value.status, logs: value.logs });
  });
  server.registerTool("jenkins_get_test_report", { title: "Get Jenkins JUnit summary", description: "Read JUnit totals for an allowlisted Jenkins job.", inputSchema }, async input => {
    const value = await report(input.jobPath, input.buildNumber);
    return json({ buildUrl: value.buildUrl, status: value.status, testResults: value.testResults });
  });
  return server;
}
function json(data: unknown) { return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] }; }
if (process.argv[1] && /jenkins-mcp[\\/]server\.(?:ts|js)$/.test(process.argv[1])) {
  const config = loadJenkinsMcpConfig();
  createJenkinsMcpApp(new JenkinsCiProvider(config), config).listen(config.port, config.bindHost, () => console.log(`jenkins-mcp is listening on http://${config.bindHost}:${config.port}/mcp`));
}
