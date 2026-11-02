import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CodeReviewService, type CodeReviewer } from "../src/agents/code-reviewer.js";
import { draftFingerprint, type StagedTestDraft } from "../src/code-changes/staged-draft.js";
import { approveStage, createWorkflow } from "../src/workflow/lifecycle.js";
import { SqliteWorkflowStore } from "../src/workflow/store.js";

const directories: string[] = [];

afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("CodeReviewService", () => {
  it("stores an APPROVE verdict bound to the reviewed staged draft", async () => {
    const root = mkdtempSync(join(tmpdir(), "code-review-")); directories.push(root);
    const store = new SqliteWorkflowStore(join(root, "workflows.db"));
    const initial = createWorkflow("DEMO-15", new Date("2026-11-02T08:00:00.000Z"));
    const workflow = { ...initial, stage: "CODE_REVIEW" as const };
    store.create(workflow);
    const directory = join(root, "artifacts", workflow.issueKey, workflow.id); mkdirSync(directory, { recursive: true });
    const draft: StagedTestDraft = { path: "tests/login.spec.ts", content: "it('logs in', () => {});" };
    writeFileSync(join(directory, "staged-test-draft.json"), JSON.stringify(draft));
    writeFileSync(join(directory, "implementation-proposal.md"), "Add login coverage.");
    const reviewer: CodeReviewer = { review: async () => "## Verdict\nAPPROVE\n\n## Notes\nLooks safe." };

    const result = await new CodeReviewService(store, reviewer, join(root, "artifacts")).run(workflow.id);
    const reviewed = store.find(workflow.id)!;

    expect(result.verdict).toBe("APPROVE");
    expect(readFileSync(result.artifactPath, "utf8")).toContain("Looks safe.");
    expect(reviewed).toMatchObject({ status: "PENDING_APPROVAL", reviewVerdict: "APPROVE", draftFingerprint: draftFingerprint(draft), reviewedDraftFingerprint: draftFingerprint(draft) });
    expect(approveStage(reviewed, "CODE_REVIEW")).toMatchObject({ stage: "LOCAL_TESTS" });
    store.close();
  });

  it("does not allow a REQUEST_CHANGES review to advance the workflow", async () => {
    const root = mkdtempSync(join(tmpdir(), "code-review-reject-")); directories.push(root);
    const store = new SqliteWorkflowStore(join(root, "workflows.db"));
    const initial = createWorkflow("DEMO-16", new Date("2026-11-02T08:00:00.000Z"));
    const workflow = { ...initial, stage: "CODE_REVIEW" as const };
    store.create(workflow);
    const directory = join(root, "artifacts", workflow.issueKey, workflow.id); mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "staged-test-draft.json"), JSON.stringify({ path: "tests/login.spec.ts", content: "test" }));
    const reviewer: CodeReviewer = { review: async () => "## Verdict\nREQUEST_CHANGES" };

    await new CodeReviewService(store, reviewer, join(root, "artifacts")).run(workflow.id);

    expect(() => approveStage(store.find(workflow.id)!, "CODE_REVIEW")).toThrow("requires an APPROVE verdict");
    store.close();
  });
});
