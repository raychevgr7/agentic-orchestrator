import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TestDesignService, type TestPlanner } from "../src/agents/test-designer.js";
import { approveStage, createWorkflow } from "../src/workflow/lifecycle.js";
import { SqliteWorkflowStore } from "../src/workflow/store.js";
const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
describe("TestDesignService", () => {
  it("uses the saved issue analysis and writes a test plan", async () => {
    const root = mkdtempSync(join(tmpdir(), "test-design-")); directories.push(root); const store = new SqliteWorkflowStore(join(root, "workflows.db"));
    const initial = createWorkflow("DEMO-14", new Date("2026-11-02T08:00:00.000Z")); const workflow = approveStage(initial, "ISSUE_ANALYSIS"); store.create(workflow);
    const directory = join(root, "artifacts", workflow.issueKey, workflow.id); mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, "issue-analysis.md"), "## Summary\nLogin change");
    const planner: TestPlanner = { design: async (_key, analysis) => `## Test scope\n${analysis}` };
    const result = await new TestDesignService(store, planner, join(root, "artifacts")).run("DEMO-14");
    expect(readFileSync(result.artifactPath, "utf8")).toContain("Login change"); expect(store.find("DEMO-14")).toMatchObject({ stage: "TEST_PLAN", status: "PENDING_APPROVAL" }); store.close();
  });
});
