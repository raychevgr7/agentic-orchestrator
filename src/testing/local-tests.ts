import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { loadTestExecutionPolicy } from "./execution-policy.js";
import type { WorkflowStore } from "../workflow/store.js";
import { markRunning, recoverWorkflow } from "../workflow/lifecycle.js";

export class LocalTestsService {
  public constructor(private readonly store: WorkflowStore, private readonly artifactsRoot: string, private readonly execute: (command: string) => Promise<number> = runCommand) {}
  public async run(idOrIssueKey: string, target: string): Promise<{ passed: boolean; artifactPath: string }> {
    if (!/^[A-Za-z0-9_./-]+$/.test(target)) throw new Error("Test target must be a repository-relative path without spaces or shell characters.");
    const workflow = this.store.find(idOrIssueKey); if (!workflow) throw new Error(`Workflow '${idOrIssueKey}' was not found.`);
    const running = markRunning(workflow, "LOCAL_TESTS"); this.store.save(running);
    const template = process.env.PROJECT_TEST_COMMAND_TEMPLATE?.trim(); if (!template?.includes("{test}")) { this.store.save(recoverWorkflow(running)); throw new Error("PROJECT_TEST_COMMAND_TEMPLATE must include {test}."); }
    const command = template.replaceAll("{test}", target); const policy = loadTestExecutionPolicy(); const outcomes: number[] = [];
    for (let attempt = 0; attempt < policy.requiredConsecutiveSuccesses; attempt += 1) { const exitCode = await this.execute(command); outcomes.push(exitCode); if (exitCode !== 0) break; }
    const directory = join(resolve(this.artifactsRoot), workflow.issueKey, workflow.id); mkdirSync(directory, { recursive: true }); const artifactPath = join(directory, "targeted-test-results.json");
    const passed = outcomes.length === policy.requiredConsecutiveSuccesses && outcomes.every(code => code === 0); writeFileSync(artifactPath, JSON.stringify({ target, command, requiredConsecutiveSuccesses: policy.requiredConsecutiveSuccesses, outcomes, passed }, null, 2));
    this.store.save(passed ? recoverWorkflow(running) : { ...running, status: "REJECTED", updatedAt: new Date().toISOString(), feedback: "Targeted test validation failed; inspect targeted-test-results.json before retrying." });
    return { passed, artifactPath };
  }
}
function runCommand(command: string): Promise<number> { return new Promise((resolveRun, reject) => { const process = spawn(command, { shell: true, stdio: "inherit" }); process.on("error", reject); process.on("close", code => resolveRun(code ?? 1)); }); }
