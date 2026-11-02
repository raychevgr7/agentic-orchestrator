import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createJiraMcpApp } from "../src/jira-mcp/server.js";
import type { JiraClient } from "../src/jira-mcp/client.js";
import type { JiraConfig } from "../src/jira-mcp/config.js";

const servers: Array<ReturnType<ReturnType<typeof createJiraMcpApp>["listen"]>> = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>((resolveClose, rejectClose) => server.close(error => error ? rejectClose(error) : resolveClose())))); });

describe("jira-mcp HTTP integration", () => {
  it("serves an allowed Jira issue through a real MCP HTTP client", async () => {
    const config: JiraConfig = { baseUrl: "https://jira.example.test", email: "qa@example.test", apiToken: "test-token", allowedProjectKeys: ["DEMO"], port: 3001, bindHost: "127.0.0.1" };
    const calls: string[] = [];
    const jira = { getIssue: async (issueKey: string) => { calls.push(issueKey); return { key: issueKey, fields: { summary: "Login regression" } }; } } as unknown as JiraClient;
    const httpServer = createJiraMcpApp(config, jira).listen(0, "127.0.0.1"); servers.push(httpServer);
    await once(httpServer, "listening");
    const address = httpServer.address(); if (!address || typeof address === "string") throw new Error("Could not determine the test server port.");
    const client = new Client({ name: "jira-mcp-http-test", version: "0.1.0" });

    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`)));
      const result = await client.callTool({ name: "jira_get_issue", arguments: { issueKey: "demo-42" } });
      const content = result.content as Array<{ type: string; text?: string }>;
      expect(JSON.parse(content[0]?.text ?? "{}")).toMatchObject({ key: "DEMO-42", fields: { summary: "Login regression" } });
      expect(calls).toEqual(["DEMO-42"]);
    } finally {
      await client.close();
    }
  });
});
