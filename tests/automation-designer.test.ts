import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AutomationDiscoveryService, type AutomationDecider, type ProjectDiscoverer } from "../src/agents/automation-designer.js";
import { createWorkflow } from "../src/workflow/lifecycle.js";
import { SqliteWorkflowStore } from "../src/workflow/store.js";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("AutomationDiscoveryService", () => {
  it("uses the saved test plan, persists discovery context, and returns to approval", async () => {
    const root = mkdtempSync(join(tmpdir(), "automation-discovery-")); directories.push(root);
    const store = new SqliteWorkflowStore(join(root, "workflows.db"));
    const initial = createWorkflow("DEMO-21", new Date("2026-11-02T08:00:00.000Z"));
    const workflow = { ...initial, stage: "PROJECT_DISCOVERY" as const };
    store.create(workflow);
    const directory = join(root, "artifacts", workflow.issueKey, workflow.id); mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "test-plan.md"), "## Scope\nLogin validation");
    const discovery = { tests: ["tests/login.spec.ts"], relevantFiles: ["pages/LoginPage.ts"] };
    const discoverer: ProjectDiscoverer = { discover: async plan => { expect(plan).toContain("Login validation"); return discovery; } };
    const decider: AutomationDecider = { decide: async (issueKey, plan, context) => { expect(issueKey).toBe("DEMO-21"); expect(plan).toContain("Login validation"); expect(context).toEqual(discovery); return "## Automation decision\nExtend the existing login test."; } };

    const result = await new AutomationDiscoveryService(store, discoverer, decider, join(root, "artifacts")).run(workflow.id);

    expect(readFileSync(result.artifactPath, "utf8")).toContain("Extend the existing login test");
    expect(JSON.parse(readFileSync(join(directory, "project-discovery-context.json"), "utf8"))).toEqual(discovery);
    expect(store.find(workflow.id)).toMatchObject({ stage: "PROJECT_DISCOVERY", status: "PENDING_APPROVAL" });
    store.close();
  });
});
