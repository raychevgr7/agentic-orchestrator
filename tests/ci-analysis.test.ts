import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CiAnalysisService, type CiAnalyst } from "../src/ci/ci-analysis.js";
import type { CiBuildReport, CiProvider } from "../src/ci/provider.js";
import { createWorkflow } from "../src/workflow/lifecycle.js";
import { SqliteWorkflowStore } from "../src/workflow/store.js";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("CiAnalysisService", () => {
  it.each(["SUCCESS", "FAILURE", "RUNNING"] as const)("records a %s Jenkins report and returns to the approval gate", async (status) => {
    const root = mkdtempSync(join(tmpdir(), "ci-analysis-")); directories.push(root);
    const store = new SqliteWorkflowStore(join(root, "workflows.db"));
    const workflow = { ...createWorkflow("DEMO-31", new Date("2026-11-02T08:00:00.000Z")), stage: "CI_ANALYSIS" as const };
    store.create(workflow);
    const report: CiBuildReport = { provider: "jenkins", reference: "job/ui/31", status, buildUrl: "https://ci.example.test/job/ui/31", logs: "test output", testResults: { total: 4, failed: status === "FAILURE" ? 1 : 0, skipped: 0 } };
    const provider: CiProvider = { getBuild: async () => report };
    const analyst: CiAnalyst = { analyze: async (issueKey, current) => `## Build status\n${issueKey}: ${current.status}` };

    const result = await new CiAnalysisService(store, provider, analyst, join(root, "artifacts"), "job/ui").run(workflow.id, "31");

    expect(result.status).toBe(status);
    expect(report.reference).toBe("job/ui/31");
    expect(readFileSync(result.artifactPath, "utf8")).toContain(status);
    expect(JSON.parse(readFileSync(join(root, "artifacts", workflow.issueKey, workflow.id, "ci-build-report.json"), "utf8"))).toMatchObject({ status });
    expect(store.find(workflow.id)).toMatchObject({ stage: "CI_ANALYSIS", status: "PENDING_APPROVAL" });
    store.close();
  });

  it("rejects a non-numeric build number before changing the workflow", async () => {
    const root = mkdtempSync(join(tmpdir(), "ci-analysis-number-")); directories.push(root);
    const store = new SqliteWorkflowStore(join(root, "workflows.db"));
    const workflow = { ...createWorkflow("DEMO-32"), stage: "CI_ANALYSIS" as const }; store.create(workflow);
    const provider: CiProvider = { getBuild: async () => { throw new Error("must not be called"); } };
    const analyst: CiAnalyst = { analyze: async () => "unused" };
    await expect(new CiAnalysisService(store, provider, analyst, join(root, "artifacts"), "job/ui").run(workflow.id, "job/ui/32")).rejects.toThrow("positive integer");
    expect(store.find(workflow.id)).toMatchObject({ stage: "CI_ANALYSIS", status: "PENDING_APPROVAL" });
    store.close();
  });
});
