import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PullRequestPreparationService, type PullRequestWriter } from "../src/agents/pull-request.js";
import { createWorkflow } from "../src/workflow/lifecycle.js";
import { SqliteWorkflowStore } from "../src/workflow/store.js";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("PullRequestPreparationService", () => {
  it("writes a PR description from implementation and targeted-test artifacts", async () => {
    const root = mkdtempSync(join(tmpdir(), "pr-preparation-")); directories.push(root);
    const store = new SqliteWorkflowStore(join(root, "workflows.db"));
    const workflow = { ...createWorkflow("DEMO-22", new Date("2026-11-02T08:00:00.000Z")), stage: "PULL_REQUEST" as const };
    store.create(workflow);
    const directory = join(root, "artifacts", workflow.issueKey, workflow.id); mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "implementation-proposal.md"), "Add login test.");
    writeFileSync(join(directory, "issue-analysis.md"), "## Feature\nLogin validation");
    writeFileSync(join(directory, "test-plan.md"), "## Scenario\nInvalid password message");
    writeFileSync(join(directory, "automation-decision.md"), "Automate the login validation flow.");
    writeFileSync(join(directory, "targeted-test-results.json"), '{"passed":true}');
    const writer: PullRequestWriter = { prepare: async (issueKey, context) => { expect(issueKey).toBe("DEMO-22"); expect(context).toContain("Login validation"); expect(context).toContain("Invalid password message"); expect(context).toContain("Automate the login validation flow"); expect(context).toContain('"passed":true'); return "## Title\nAdd login coverage\n\n## Summary\nAdds regression coverage."; } };

    const result = await new PullRequestPreparationService(store, writer, join(root, "artifacts")).run(workflow.id);
    expect(readFileSync(result.artifactPath, "utf8")).toContain("Add login coverage");
    expect(store.find(workflow.id)).toMatchObject({ stage: "PULL_REQUEST", status: "PENDING_APPROVAL" });
    store.close();
  });

  it("rejects missing, malformed, or failed targeted-test validation evidence", async () => {
    const root = mkdtempSync(join(tmpdir(), "pr-validation-")); directories.push(root);
    const store = new SqliteWorkflowStore(join(root, "workflows.db"));
    const workflow = { ...createWorkflow("DEMO-23", new Date("2026-11-02T08:00:00.000Z")), stage: "PULL_REQUEST" as const };
    store.create(workflow);
    const directory = join(root, "artifacts", workflow.issueKey, workflow.id); mkdirSync(directory, { recursive: true });
    const writer: PullRequestWriter = { prepare: async () => "should not run" };
    const service = new PullRequestPreparationService(store, writer, join(root, "artifacts"));

    await expect(service.run(workflow.id)).rejects.toThrow("passing targeted-test-results.json");
    writeFileSync(join(directory, "targeted-test-results.json"), "not json");
    await expect(service.run(workflow.id)).rejects.toThrow("malformed");
    writeFileSync(join(directory, "targeted-test-results.json"), '{"passed":false}');
    await expect(service.run(workflow.id)).rejects.toThrow("passed: true");
    store.close();
  });

  it("puts validation, review, and implementation evidence before large ticket context", async () => {
    const root = mkdtempSync(join(tmpdir(), "pr-context-order-")); directories.push(root);
    const store = new SqliteWorkflowStore(join(root, "workflows.db"));
    const workflow = { ...createWorkflow("DEMO-24"), stage: "PULL_REQUEST" as const }; store.create(workflow);
    const directory = join(root, "artifacts", workflow.issueKey, workflow.id); mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "targeted-test-results.json"), '{"passed":true}'); writeFileSync(join(directory, "code-review.md"), "APPROVE"); writeFileSync(join(directory, "implementation-proposal.md"), "implementation"); writeFileSync(join(directory, "issue-analysis-context.json"), "x".repeat(60_000));
    const writer: PullRequestWriter = { prepare: async (_key, context) => { expect(context.indexOf("targeted-test-results")).toBeLessThan(context.indexOf("issue-analysis-context")); expect(context).toContain("APPROVE"); expect(context).toContain("implementation"); expect(context.length).toBeLessThanOrEqual(46_000); return "PR"; } };
    await new PullRequestPreparationService(store, writer, join(root, "artifacts")).run(workflow.id); store.close();
  });
});
