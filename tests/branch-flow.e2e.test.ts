import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PullRequestPreparationService, type PullRequestWriter } from "../src/agents/pull-request.js";
import { FeatureBranchService } from "../src/code-changes/git-branch.js";
import { applyDraft } from "../src/code-changes/staged-draft.js";
import { createWorkflow } from "../src/workflow/lifecycle.js";
import { SqliteWorkflowStore } from "../src/workflow/store.js";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("branch flow end-to-end", () => {
  it("creates an issue-named branch from master, writes the test, and prepares PR evidence", async () => {
    const root = mkdtempSync(join(tmpdir(), "branch-flow-")); directories.push(root);
    const project = join(root, "project"); mkdirSync(join(project, "tests"), { recursive: true });
    git(project, "init", "-b", "master"); git(project, "config", "user.email", "test@example.com"); git(project, "config", "user.name", "Test User");
    writeFileSync(join(project, "README.md"), "fixture\n"); git(project, "add", "."); git(project, "commit", "-m", "initial");

    const branch = new FeatureBranchService(project).ensure("DEMO-42", "Login validation error");
    applyDraft(project, { path: "tests/login.spec.ts", content: "test('login validation', () => {});\n" });
    expect(branch).toBe("DEMO-42/login-validation-error");
    expect(git(project, "branch", "--show-current").trim()).toBe(branch);
    expect(readFileSync(join(project, "tests", "login.spec.ts"), "utf8")).toContain("login validation");

    const store = new SqliteWorkflowStore(join(root, "workflows.db"));
    const workflow = { ...createWorkflow("DEMO-42", new Date("2026-11-02T08:00:00.000Z")), stage: "PULL_REQUEST" as const }; store.create(workflow);
    const artifacts = join(root, "artifacts", workflow.issueKey, workflow.id); mkdirSync(artifacts, { recursive: true });
    writeFileSync(join(artifacts, "implementation-proposal.md"), "Add login validation automation.");
    writeFileSync(join(artifacts, "targeted-test-results.json"), JSON.stringify({ target: "tests/login.spec.ts", outcomes: [0, 0, 0], passed: true }));
    const writer: PullRequestWriter = { prepare: async (_key, context) => { expect(context).toContain("tests/login.spec.ts"); return `## Title\n${branch}\n\n## Test evidence\nThree targeted passes.`; } };
    const result = await new PullRequestPreparationService(store, writer, join(root, "artifacts")).run(workflow.id);
    expect(readFileSync(result.artifactPath, "utf8")).toContain(branch);
    store.close();
  });
});

function git(cwd: string, ...args: string[]): string { return execFileSync("git", args, { cwd, encoding: "utf8" }); }
