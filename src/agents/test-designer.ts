import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import OpenAI from "openai";
import { loadTestDesignerRule } from "../agent-rules.js";
import { markRunning, recoverWorkflow } from "../workflow/lifecycle.js";
import type { WorkflowStore } from "../workflow/store.js";

export interface TestPlanner { design(issueKey: string, issueAnalysis: string): Promise<string>; }

export class OpenAITestPlanner implements TestPlanner {
  public async design(issueKey: string, issueAnalysis: string): Promise<string> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new Error("OPENAI_API_KEY is missing. Add it only to your local .env file.");
    const response = await new OpenAI({ apiKey }).responses.create({
      model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini", max_output_tokens: 1_200, store: false,
      input: [{ role: "developer", content: loadTestDesignerRule() }, { role: "user", content: `Design a test plan for ${issueKey} using only this issue analysis:\n\n${issueAnalysis.slice(0, 45_000)}` }],
    });
    if (response.status !== "completed" || !response.output_text.trim()) throw new Error(`Test design did not complete successfully (status: ${response.status}).`);
    return response.output_text.trim();
  }
}

export class TestDesignService {
  public constructor(private readonly store: WorkflowStore, private readonly planner: TestPlanner, private readonly artifactsRoot: string) {}

  public async run(idOrIssueKey: string): Promise<{ artifactPath: string }> {
    const workflow = this.store.find(idOrIssueKey);
    if (!workflow) throw new Error(`Workflow '${idOrIssueKey}' was not found.`);
    const running = markRunning(workflow, "TEST_PLAN"); this.store.save(running);
    try {
      const directory = join(resolve(this.artifactsRoot), workflow.issueKey, workflow.id);
      const analysisPath = join(directory, "issue-analysis.md");
      if (!existsSync(analysisPath)) throw new Error("Issue analysis artifact was not found. Complete ISSUE_ANALYSIS first.");
      const plan = await this.planner.design(workflow.issueKey, readFileSync(analysisPath, "utf8"));
      mkdirSync(directory, { recursive: true });
      const artifactPath = join(directory, "test-plan.md"); writeFileSync(artifactPath, `${plan}\n`, "utf8");
      this.store.save(recoverWorkflow(running)); return { artifactPath };
    } catch (error) { this.store.save(recoverWorkflow(running)); throw error; }
  }
}
