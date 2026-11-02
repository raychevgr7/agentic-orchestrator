import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createProjectMcpApp } from "../src/project-mcp/server.js";
import { ProjectSource } from "../src/project-mcp/source.js";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("project-mcp HTTP integration", () => {
  it("serves a read-only MCP tool over loopback HTTP", async () => {
    const root = mkdtempSync(join(tmpdir(), "project-mcp-http-")); directories.push(root);
    mkdirSync(join(root, "tests")); writeFileSync(join(root, "tests", "login.spec.ts"), "test('login', () => {});");
    const httpServer = createProjectMcpApp(new ProjectSource(root)).listen(0, "127.0.0.1");
    await once(httpServer, "listening");
    const address = httpServer.address(); if (!address || typeof address === "string") throw new Error("Could not determine the test server port.");
    const client = new Client({ name: "project-mcp-http-test", version: "0.1.0" });

    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`)));
      const result = await client.callTool({ name: "project_list_tests", arguments: { maxResults: 10 } });
      const content = result.content as Array<{ type: string; text?: string }>;
      expect(JSON.parse(content[0]?.text ?? "{}")).toEqual({ files: ["tests/login.spec.ts"] });
    } finally {
      await client.close();
      await new Promise<void>((resolveClose, rejectClose) => httpServer.close(error => error ? rejectClose(error) : resolveClose()));
    }
  });
});
