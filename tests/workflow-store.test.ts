import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkflow } from "../src/workflow/lifecycle.js";
import { SqliteWorkflowStore } from "../src/workflow/store.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("SqliteWorkflowStore", () => {
  it("stores and retrieves a workflow by id or the newest matching issue key", () => {
    const directory = mkdtempSync(join(tmpdir(), "agentic-orchestrator-"));
    temporaryDirectories.push(directory);
    const store = new SqliteWorkflowStore(join(directory, "workflows.db"));
    const first = createWorkflow("DEMO-42", new Date("2026-11-02T08:00:00.000Z"));
    const second = createWorkflow("DEMO-42", new Date("2026-11-02T09:00:00.000Z"));

    store.create(first);
    store.create(second);

    expect(store.find(first.id)).toEqual(first);
    expect(store.find("demo-42")).toEqual(second);
    store.close();
  });
});
