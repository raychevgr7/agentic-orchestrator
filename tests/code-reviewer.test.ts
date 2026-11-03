import { execFileSync } from "node:child_process";
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
    expect(approveStage(reviewed, "CODE_REVIEW")).toMatchObject({ stage: "PULL_REQUEST" });
    store.close();
  });

  it("returns a REQUEST_CHANGES review to CODE_CHANGE for remediation", async () => {
    const root = mkdtempSync(join(tmpdir(), "code-review-reject-")); directories.push(root);
    const store = new SqliteWorkflowStore(join(root, "workflows.db"));
    const initial = createWorkflow("DEMO-16", new Date("2026-11-02T08:00:00.000Z"));
    const workflow = { ...initial, stage: "CODE_REVIEW" as const };
    store.create(workflow);
    const directory = join(root, "artifacts", workflow.issueKey, workflow.id); mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "staged-test-draft.json"), JSON.stringify({ path: "tests/login.spec.ts", content: "test" }));
    const reviewer: CodeReviewer = { review: async () => "## Verdict\nREQUEST_CHANGES" };

    await new CodeReviewService(store, reviewer, join(root, "artifacts")).run(workflow.id);

    const updated = store.find(workflow.id)!;
    expect(updated).toMatchObject({ stage: "CODE_CHANGE", status: "PENDING_APPROVAL", reviewVerdict: "REQUEST_CHANGES" });
    expect(updated.feedback).toContain("Code review returned REQUEST_CHANGES");
    expect(() => approveStage(updated, "CODE_REVIEW")).toThrow("waiting at CODE_CHANGE");
    store.close();
  });

  it("includes the actual feature-branch Git diff in review context", async () => {
    const root = mkdtempSync(join(tmpdir(), "code-review-diff-")); directories.push(root);
    const project = join(root, "project"); mkdirSync(join(project, "tests"), { recursive: true });
    git(project, "init", "-b", "master"); git(project, "config", "user.email", "test@example.com"); git(project, "config", "user.name", "Test User"); writeFileSync(join(project, "README.md"), "fixture"); git(project, "add", "."); git(project, "commit", "-m", "initial");
    writeFileSync(join(project, "tests", "login.spec.ts"), "test('actual diff', () => {});\n");
    const store = new SqliteWorkflowStore(join(root, "workflows.db")); const workflow = { ...createWorkflow("DEMO-17"), stage: "CODE_REVIEW" as const }; store.create(workflow);
    const directory = join(root, "artifacts", workflow.issueKey, workflow.id); mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, "staged-test-draft.json"), JSON.stringify({ path: "tests/login.spec.ts", content: "test('actual diff', () => {});" }));
    const reviewer: CodeReviewer = { review: async context => { expect(context).toContain("## Actual Git diff"); expect(context).toContain("actual diff"); return "## Verdict\nAPPROVE"; } };
    await new CodeReviewService(store, reviewer, join(root, "artifacts"), project).run(workflow.id);
    store.close();
  });

  it("includes committed feature-branch changes against the base branch", async () => {
    const root = mkdtempSync(join(tmpdir(), "code-review-committed-diff-")); directories.push(root);
    const project = join(root, "project"); mkdirSync(join(project, "tests"), { recursive: true });
    git(project, "init", "-b", "master"); git(project, "config", "user.email", "test@example.com"); git(project, "config", "user.name", "Test User"); writeFileSync(join(project, "README.md"), "fixture"); git(project, "add", "."); git(project, "commit", "-m", "initial");
    git(project, "switch", "-c", "DEMO-18/committed-review"); writeFileSync(join(project, "tests", "committed.spec.ts"), "test('committed review', () => {});\n"); git(project, "add", "."); git(project, "commit", "-m", "add committed test");
    const store = new SqliteWorkflowStore(join(root, "workflows.db")); const workflow = { ...createWorkflow("DEMO-18"), stage: "CODE_REVIEW" as const }; store.create(workflow);
    const directory = join(root, "artifacts", workflow.issueKey, workflow.id); mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, "staged-test-draft.json"), JSON.stringify({ path: "tests/committed.spec.ts", content: "test('committed review', () => {});" }));
    const reviewer: CodeReviewer = { review: async context => { expect(context).toContain("committed review"); expect(context).toContain("against master"); return "## Verdict\nAPPROVE"; } };
    await new CodeReviewService(store, reviewer, join(root, "artifacts"), project).run(workflow.id);
    store.close();
  });
});

function git(cwd: string, ...args: string[]): string { return execFileSync("git", args, { cwd, encoding: "utf8" }); }
