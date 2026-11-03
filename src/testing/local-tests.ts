import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import type { WorkflowStore } from "../workflow/store.js";
import { markRunning, recoverWorkflow } from "../workflow/lifecycle.js";

export class LocalTestsService {
  public constructor(private readonly store: WorkflowStore, private readonly artifactsRoot: string, private readonly execute: (command: string) => Promise<number> = runCommand) {}
  public async run(idOrIssueKey: string, target: string): Promise<{ passed: boolean; artifactPath: string }> {
    assertSafeTestTarget(target, process.env.PROJECT_SOURCE_ROOT);
    assertPlaywrightTestTarget(target);
    const workflow = this.store.find(idOrIssueKey); if (!workflow) throw new Error(`Workflow '${idOrIssueKey}' was not found.`);
    const running = markRunning(workflow, "LOCAL_TESTS"); this.store.save(running);
    const command = `npx playwright test ${target}`;
    const policy = { requiredConsecutiveSuccesses: 3 }; const outcomes: number[] = [];
    for (let attempt = 0; attempt < policy.requiredConsecutiveSuccesses; attempt += 1) { const exitCode = await this.execute(command); outcomes.push(exitCode); if (exitCode !== 0) break; }
    const directory = join(resolve(this.artifactsRoot), workflow.issueKey, workflow.id); mkdirSync(directory, { recursive: true }); const artifactPath = join(directory, "targeted-test-results.json");
    const passed = outcomes.length === policy.requiredConsecutiveSuccesses && outcomes.every(code => code === 0); writeFileSync(artifactPath, JSON.stringify({ target, command, requiredConsecutiveSuccesses: policy.requiredConsecutiveSuccesses, outcomes, passed }, null, 2));
    this.store.save(passed ? recoverWorkflow(running) : { ...running, status: "REJECTED", updatedAt: new Date().toISOString(), feedback: "Targeted test validation failed; inspect targeted-test-results.json before retrying." });
    return { passed, artifactPath };
  }
}

export function assertPlaywrightTestTarget(target: string): void {
  const normalized = target.replace(/\\/g, "/").toLowerCase();
  const withinTestDirectory = normalized.startsWith("tests/");
  const hasTestExtension = normalized.endsWith(".spec.ts") || normalized.endsWith(".test.ts");
  if (!withinTestDirectory || !hasTestExtension) {
    throw new Error("Test target must be a .spec.ts or .test.ts file inside tests/.");
  }
}

export function isRepositoryRelativeTestTarget(target: string): boolean {
  return /^[A-Za-z0-9_./-]+$/.test(target) && !target.startsWith("/") && target.split("/").every(segment => segment.length > 0 && segment !== "." && segment !== "..");
}

export function assertSafeTestTarget(target: string, projectSourceRoot: string | undefined): void {
  if (!isRepositoryRelativeTestTarget(target)) {
    throw new Error("Test target must be a repository-relative path without traversal, spaces, or shell characters.");
  }
  if (!projectSourceRoot?.trim()) throw new Error("PROJECT_SOURCE_ROOT is required to validate a test target.");
  const root = realpathSync(projectSourceRoot);
  const resolvedTarget = realpathSync(resolve(root, target));
  if (resolvedTarget !== root && !resolvedTarget.startsWith(`${root}\\`) && !resolvedTarget.startsWith(`${root}/`)) {
    throw new Error("Test target must resolve inside PROJECT_SOURCE_ROOT.");
  }
}
function runCommand(command: string): Promise<number> { return new Promise((resolveRun, reject) => { const process = spawn(command, { shell: true, stdio: "inherit" }); process.on("error", reject); process.on("close", code => resolveRun(code ?? 1)); }); }
