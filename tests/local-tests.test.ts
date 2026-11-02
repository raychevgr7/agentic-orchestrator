import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalTestsService } from "../src/testing/local-tests.js";
import { createWorkflow } from "../src/workflow/lifecycle.js";
import { SqliteWorkflowStore } from "../src/workflow/store.js";

const directories: string[] = [];
const originalTemplate = process.env.PROJECT_TEST_COMMAND_TEMPLATE;
const originalRepetitions = process.env.TEST_SUCCESS_REPETITIONS;

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  process.env.PROJECT_TEST_COMMAND_TEMPLATE = originalTemplate;
  process.env.TEST_SUCCESS_REPETITIONS = originalRepetitions;
});

describe("LocalTestsService", () => {
  it("runs only the requested test three times and accepts three consecutive successes", async () => {
    const { store, workflow, artifactsRoot } = setup("DEMO-17");
    process.env.PROJECT_TEST_COMMAND_TEMPLATE = "npm test -- {test}";
    process.env.TEST_SUCCESS_REPETITIONS = "3";
    const commands: string[] = [];
    const result = await new LocalTestsService(store, artifactsRoot, async command => { commands.push(command); return 0; }).run(workflow.id, "tests/login.spec.ts");

    expect(result.passed).toBe(true);
    expect(commands).toEqual(["npm test -- tests/login.spec.ts", "npm test -- tests/login.spec.ts", "npm test -- tests/login.spec.ts"]);
    expect(store.find(workflow.id)).toMatchObject({ stage: "LOCAL_TESTS", status: "PENDING_APPROVAL" });
    expect(JSON.parse(readFileSync(result.artifactPath, "utf8"))).toMatchObject({ target: "tests/login.spec.ts", outcomes: [0, 0, 0], passed: true });
    store.close();
  });

  it("stops at the first failure and rejects the workflow for an explicit retry", async () => {
    const { store, workflow, artifactsRoot } = setup("DEMO-18");
    process.env.PROJECT_TEST_COMMAND_TEMPLATE = "npm test -- {test}";
    process.env.TEST_SUCCESS_REPETITIONS = "3";
    const outcomes = [0, 1];
    const result = await new LocalTestsService(store, artifactsRoot, async () => outcomes.shift() ?? 0).run(workflow.id, "tests/login.spec.ts");

    expect(result.passed).toBe(false);
    expect(store.find(workflow.id)).toMatchObject({ stage: "LOCAL_TESTS", status: "REJECTED" });
    expect(JSON.parse(readFileSync(result.artifactPath, "utf8"))).toMatchObject({ outcomes: [0, 1], passed: false });
    store.close();
  });
});

function setup(issueKey: string) {
  const root = mkdtempSync(join(tmpdir(), "local-tests-")); directories.push(root);
  const store = new SqliteWorkflowStore(join(root, "workflows.db"));
  const workflow = { ...createWorkflow(issueKey, new Date("2026-11-02T08:00:00.000Z")), stage: "LOCAL_TESTS" as const };
  store.create(workflow);
  return { store, workflow, artifactsRoot: join(root, "artifacts") };
}
