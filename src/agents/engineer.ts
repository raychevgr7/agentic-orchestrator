import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import OpenAI from "openai";
import { loadEngineerRule } from "../agent-rules.js";
import { loadTestExecutionPolicy } from "../testing/execution-policy.js";
import { markRunning, recoverWorkflow } from "../workflow/lifecycle.js";
import type { WorkflowStore } from "../workflow/store.js";

export interface EngineerPlanner { propose(issueKey: string, decision: string, context: string): Promise<string>; }
export class OpenAIEngineerPlanner implements EngineerPlanner {
  public async propose(issueKey: string, decision: string, context: string): Promise<string> {
    const apiKey = process.env.OPENAI_API_KEY?.trim(); if (!apiKey) throw new Error("OPENAI_API_KEY is missing. Add it only to your local .env file.");
    const repetitions = loadTestExecutionPolicy().requiredConsecutiveSuccesses;
    const response = await new OpenAI({ apiKey }).responses.create({ model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini", max_output_tokens: 1_200, store: false, input: [{ role: "developer", content: loadEngineerRule().replace("{{TEST_SUCCESS_REPETITIONS}}", String(repetitions)) }, { role: "user", content: `Create an implementation proposal for ${issueKey}.\n\nAUTOMATION DECISION:\n${decision.slice(0, 30_000)}\n\nPROJECT DISCOVERY:\n${context.slice(0, 30_000)}` }] });
    if (response.status !== "completed" || !response.output_text.trim()) throw new Error(`Engineering proposal did not complete successfully (status: ${response.status}).`); return response.output_text.trim();
  }
}
export class EngineerPlanningService {
  public constructor(private readonly store: WorkflowStore, private readonly planner: EngineerPlanner, private readonly artifactsRoot: string) {}
  public async run(idOrIssueKey: string): Promise<{ artifactPath: string }> {
    const workflow = this.store.find(idOrIssueKey); if (!workflow) throw new Error(`Workflow '${idOrIssueKey}' was not found.`); const running = markRunning(workflow, "CODE_CHANGE"); this.store.save(running);
    try { const directory = join(resolve(this.artifactsRoot), workflow.issueKey, workflow.id); const decisionPath = join(directory, "automation-decision.md"); const contextPath = join(directory, "project-discovery-context.json"); if (!existsSync(decisionPath) || !existsSync(contextPath)) throw new Error("Automation decision artifacts were not found. Complete PROJECT_DISCOVERY first."); const proposal = await this.planner.propose(workflow.issueKey, readFileSync(decisionPath, "utf8"), readFileSync(contextPath, "utf8")); mkdirSync(directory, { recursive: true }); const artifactPath = join(directory, "implementation-proposal.md"); writeFileSync(artifactPath, `${proposal}\n`); this.store.save(recoverWorkflow(running)); return { artifactPath }; } catch (error) { this.store.save(recoverWorkflow(running)); throw error; }
  }
}
