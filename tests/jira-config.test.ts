import { describe, expect, it } from "vitest";
import { loadJiraConfig } from "../src/jira-mcp/config.js";

const environment = { JIRA_BASE_URL: "https://jira.example.test/", JIRA_EMAIL: "qa@example.test", JIRA_API_TOKEN: "token", JIRA_ALLOWED_PROJECT_KEYS: "platform, WEB", JIRA_MCP_PORT: "3001" };

describe("loadJiraConfig", () => {
  it("normalizes a bounded project scope", () => {
    expect(loadJiraConfig(environment)).toMatchObject({ baseUrl: "https://jira.example.test", allowedProjectKeys: ["PLATFORM", "WEB"], bindHost: "127.0.0.1" });
  });

  it("requires an explicit project scope", () => {
    expect(() => loadJiraConfig({ ...environment, JIRA_ALLOWED_PROJECT_KEYS: "" })).toThrow("JIRA_ALLOWED_PROJECT_KEYS");
  });
});
