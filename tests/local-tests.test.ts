import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalTestsService } from "../src/testing/local-tests.js";
import { createWorkflow } from "../src/workflow/lifecycle.js";
import { SqliteWorkflowStore } from "../src/workflow/store.js";

const directories: string[] = [];
const originalProjectSourceRoot = process.env.PROJECT_SOURCE_ROOT;

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  process.env.PROJECT_SOURCE_ROOT = originalProjectSourceRoot;
});

describe("LocalTestsService", () => {
  it("runs only the requested test three times and accepts three consecutive successes", async () => {
    const { store, workflow, artifactsRoot } = setup("DEMO-17");
    const commands: string[] = [];
    const result = await new LocalTestsService(store, artifactsRoot, async command => { commands.push(command); return 0; }).run(workflow.id, "tests/login.spec.ts");

    expect(result.passed).toBe(true);
    expect(commands).toEqual(["npx playwright test tests/login.spec.ts", "npx playwright test tests/login.spec.ts", "npx playwright test tests/login.spec.ts"]);
    expect(store.find(workflow.id)).toMatchObject({ stage: "LOCAL_TESTS", status: "PENDING_APPROVAL" });
    expect(JSON.parse(readFileSync(result.artifactPath, "utf8"))).toMatchObject({ target: "tests/login.spec.ts", outcomes: [0, 0, 0], passed: true });
    store.close();
  });

  it("stops at the first failure and rejects the workflow for an explicit retry", async () => {
    const { store, workflow, artifactsRoot } = setup("DEMO-18");
    const outcomes = [0, 1];
    const result = await new LocalTestsService(store, artifactsRoot, async () => outcomes.shift() ?? 0).run(workflow.id, "tests/login.spec.ts");

    expect(result.passed).toBe(false);
    expect(store.find(workflow.id)).toMatchObject({ stage: "LOCAL_TESTS", status: "REJECTED" });
    expect(JSON.parse(readFileSync(result.artifactPath, "utf8"))).toMatchObject({ outcomes: [0, 1], passed: false });
    store.close();
  });

  it("rejects absolute paths, traversal, and targets resolving outside the project root", async () => {
    const { store, workflow, artifactsRoot, projectRoot } = setup("DEMO-19");
    process.env.PROJECT_SOURCE_ROOT = projectRoot;
    const service = new LocalTestsService(store, artifactsRoot, async () => 0);

    await expect(service.run(workflow.id, "/tmp/external-test")).rejects.toThrow("repository-relative");
    await expect(service.run(workflow.id, "../external-test")).rejects.toThrow("repository-relative");
    await expect(service.run(workflow.id, "../../external-test")).rejects.toThrow("repository-relative");
    store.close();
  });

  it("rejects a test target that escapes through a symlink", async () => {
    const { store, workflow, artifactsRoot, projectRoot } = setup("DEMO-20");
    const external = mkdtempSync(join(tmpdir(), "external-test-")); directories.push(external);
    const externalTest = join(external, "external.spec.ts"); writeFileSync(externalTest, "test");
    try { symlinkSync(externalTest, join(projectRoot, "tests", "linked.spec.ts"), "file"); } catch (error) { if (isPermissionError(error)) { store.close(); return; } throw error; }
    process.env.PROJECT_SOURCE_ROOT = projectRoot;

    await expect(new LocalTestsService(store, artifactsRoot, async () => 0).run(workflow.id, "tests/linked.spec.ts")).rejects.toThrow("inside PROJECT_SOURCE_ROOT");
    store.close();
  });

});

function setup(issueKey: string) {
  const root = mkdtempSync(join(tmpdir(), "local-tests-")); directories.push(root);
  const store = new SqliteWorkflowStore(join(root, "workflows.db"));
  const projectRoot = join(root, "project");
  mkdirSync(join(projectRoot, "tests"), { recursive: true });
  writeFileSync(join(projectRoot, "tests", "login.spec.ts"), "test");
  process.env.PROJECT_SOURCE_ROOT = projectRoot;
  const workflow = { ...createWorkflow(issueKey, new Date("2026-11-02T08:00:00.000Z")), stage: "LOCAL_TESTS" as const };
  store.create(workflow);
  return { store, workflow, artifactsRoot: join(root, "artifacts"), projectRoot };
}

function isPermissionError(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && error.code === "EPERM"; }
