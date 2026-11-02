import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JiraAnalysisService, type IssueAnalyst, type IssueReader } from "../src/agents/jira-analyst.js";
import { createWorkflow } from "../src/workflow/lifecycle.js";
import { SqliteWorkflowStore } from "../src/workflow/store.js";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("JiraAnalysisService", () => {
  it("writes an analysis artifact and returns the workflow to its approval gate", async () => {
    const root = mkdtempSync(join(tmpdir(), "jira-analysis-")); directories.push(root);
    const store = new SqliteWorkflowStore(join(root, "workflows.db"));
    const workflow = createWorkflow("DEMO-12", new Date("2026-11-02T08:00:00.000Z")); store.create(workflow);
    const reader: IssueReader = { getIssue: async () => ({ key: "DEMO-12", fields: { summary: "Login" } }) };
    const analyst: IssueAnalyst = { analyze: async () => "## Summary\nLogin analysis" };
    const result = await new JiraAnalysisService(store, reader, analyst, join(root, "artifacts")).run("DEMO-12");

    expect(readFileSync(result.artifactPath, "utf8")).toContain("Login analysis");
    expect(store.find("DEMO-12")).toMatchObject({ stage: "ISSUE_ANALYSIS", status: "PENDING_APPROVAL" });
    store.close();
  });

  it("includes parent, direct subtasks, and linked issues only when requested", async () => {
    const root = mkdtempSync(join(tmpdir(), "jira-analysis-scope-")); directories.push(root);
    const store = new SqliteWorkflowStore(join(root, "workflows.db"));
    const workflow = createWorkflow("DEMO-13", new Date("2026-11-02T08:00:00.000Z")); store.create(workflow);
    const requested: string[] = [];
    const reader: IssueReader = { getIssue: async (key) => {
      requested.push(key);
      if (key === "DEMO-13") return { key, fields: { parent: { key: "DEMO-1" }, subtasks: [{ key: "DEMO-2" }], issuelinks: [{ outwardIssue: { key: "DEMO-3" } }] } };
      return { key, fields: {} };
    } };
    const analyst: IssueAnalyst = { analyze: async (_key, context) => `related=${JSON.stringify(context.relatedIssues)}` };
    const result = await new JiraAnalysisService(store, reader, analyst, join(root, "artifacts")).run("DEMO-13", { includeParent: true, includeSubtasks: true, includeRelated: true });

    expect(requested).toEqual(["DEMO-13", "DEMO-1", "DEMO-2", "DEMO-3"]);
    expect(readFileSync(result.artifactPath, "utf8")).toContain("DEMO-3");
    store.close();
  });
});
