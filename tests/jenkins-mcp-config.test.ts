import { describe, expect, it } from "vitest";
import { loadJenkinsMcpConfig, parseAllowedJobPaths } from "../src/jenkins-mcp/config.js";

describe("Jenkins MCP configuration", () => {
  it("requires and normalizes an allowlist of safe job paths", () => {
    expect(parseAllowedJobPaths("job/qa/job/regression/, job/ui/job/smoke")).toEqual(["job/qa/job/regression", "job/ui/job/smoke"]);
    expect(() => parseAllowedJobPaths("job/qa/../private")).toThrow("relative Jenkins job paths");
    expect(() => loadJenkinsMcpConfig({ JENKINS_BASE_URL: "https://jenkins.example.test", JENKINS_USERNAME: "qa", JENKINS_API_TOKEN: "token" })).toThrow("JENKINS_ALLOWED_JOB_PATHS");
  });
});
