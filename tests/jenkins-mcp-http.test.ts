import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createJenkinsMcpApp } from "../src/jenkins-mcp/server.js";
import type { CiProvider } from "../src/ci/provider.js";

const servers: Array<ReturnType<ReturnType<typeof createJenkinsMcpApp>["listen"]>> = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>((resolveClose, rejectClose) => server.close(error => error ? rejectClose(error) : resolveClose())))); });

describe("jenkins-mcp HTTP integration", () => {
  it("reads reports only from an allowlisted job", async () => {
    const calls: string[] = [];
    const provider: CiProvider = { getBuild: async reference => {
      calls.push(reference);
      return { provider: "jenkins", reference, status: "SUCCESS", buildUrl: "https://jenkins.example.test/42", logs: "safe log", testResults: { total: 12, failed: 0, skipped: 1 } };
    } };
    const httpServer = createJenkinsMcpApp(provider, { allowedJobPaths: ["job/qa/job/regression"] }).listen(0, "127.0.0.1");
    servers.push(httpServer);
    await once(httpServer, "listening");
    const address = httpServer.address(); if (!address || typeof address === "string") throw new Error("Could not determine the test server port.");
    const client = new Client({ name: "jenkins-mcp-http-test", version: "0.1.0" });

    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`)));
      const result = await client.callTool({ name: "jenkins_get_test_report", arguments: { jobPath: "job/qa/job/regression", buildNumber: 42 } });
      const content = result.content as Array<{ type: string; text?: string }>;
      expect(JSON.parse(content[0]?.text ?? "{}")).toEqual({ buildUrl: "https://jenkins.example.test/42", status: "SUCCESS", testResults: { total: 12, failed: 0, skipped: 1 } });
      expect(calls).toEqual(["job/qa/job/regression/42"]);

      const buildResult = await client.callTool({ name: "jenkins_get_build", arguments: { jobPath: "job/qa/job/regression", buildNumber: 42 } });
      const buildContent = buildResult.content as Array<{ type: string; text?: string }>;
      expect(JSON.parse(buildContent[0]?.text ?? "{}")).toMatchObject({ reference: "job/qa/job/regression/42", status: "SUCCESS" });
      expect(JSON.parse(buildContent[0]?.text ?? "{}")).not.toHaveProperty("logs");

      const rejected = await client.callTool({ name: "jenkins_get_build", arguments: { jobPath: "job/private/job/payments", buildNumber: 42 } });
      expect(rejected.isError).toBe(true);
      expect(calls).toEqual(["job/qa/job/regression/42", "job/qa/job/regression/42"]);
    } finally {
      await client.close();
    }
  });
});
