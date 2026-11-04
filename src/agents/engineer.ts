import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import OpenAI from "openai";
import { loadEngineerDraftRule, loadEngineerRule } from "../agent-rules.js";
import { boundedTokenBudget, openAIModel, openAIReasoningEffort } from "../core/openai-config.js";
import type { StagedTestDraft } from "../code-changes/staged-draft.js";
import { markRunning, recoverWorkflow } from "../workflow/lifecycle.js";
import type { WorkflowStore } from "../workflow/store.js";

export interface EngineerPlanner { propose(issueKey: string, decision: string, context: string): Promise<string>; }
export interface EngineerDraftGenerator { generate(proposal: string): Promise<StagedTestDraft>; }
export class OpenAIEngineerDraftGenerator implements EngineerDraftGenerator {
  public async generate(proposal: string): Promise<StagedTestDraft> {
    const apiKey = process.env.OPENAI_API_KEY?.trim(); if (!apiKey) throw new Error("OPENAI_API_KEY is missing. Add it only to your local .env file.");
    const response = await new OpenAI({ apiKey }).responses.create({ model: openAIModel(), reasoning: { effort: openAIReasoningEffort() }, max_output_tokens: boundedTokenBudget("ENGINEER_DRAFT_MAX_OUTPUT_TOKENS", 2_000, 500, 4_000), store: false, input: [{ role: "developer", content: loadEngineerDraftRule() }, { role: "user", content: `IMPLEMENTATION PROPOSAL:\n${proposal.slice(0, 50_000)}` }] });
    const value = JSON.parse(response.output_text) as StagedTestDraft;
    if (!value || typeof value.path !== "string" || typeof value.content !== "string") throw new Error("Engineer draft did not match the required schema."); return value;
  }
}
export class OpenAIEngineerPlanner implements EngineerPlanner {
  public async propose(issueKey: string, decision: string, context: string): Promise<string> {
    const apiKey = process.env.OPENAI_API_KEY?.trim(); if (!apiKey) throw new Error("OPENAI_API_KEY is missing. Add it only to your local .env file.");
    const response = await new OpenAI({ apiKey }).responses.create({ model: openAIModel(), reasoning: { effort: openAIReasoningEffort() }, max_output_tokens: boundedTokenBudget("ENGINEER_PLAN_MAX_OUTPUT_TOKENS", 1_200, 500, 3_000), store: false, input: [{ role: "developer", content: loadEngineerRule() }, { role: "user", content: `Create a Playwright implementation proposal for ${issueKey}.\n\nAUTOMATION DECISION:\n${decision.slice(0, 30_000)}\n\nPROJECT DISCOVERY:\n${context.slice(0, 30_000)}` }] });
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
