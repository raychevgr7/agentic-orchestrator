import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import OpenAI from "openai";
import { loadPullRequestRule } from "../agent-rules.js";
import { markRunning, recoverWorkflow } from "../workflow/lifecycle.js";
import type { WorkflowStore } from "../workflow/store.js";

export interface PullRequestWriter { prepare(issueKey: string, context: string): Promise<string>; }

export class OpenAIPullRequestWriter implements PullRequestWriter {
  public async prepare(issueKey: string, context: string): Promise<string> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new Error("OPENAI_API_KEY is missing. Add it only to your local .env file.");
    const response = await new OpenAI({ apiKey }).responses.create({ model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini", max_output_tokens: 1_000, store: false, input: [{ role: "developer", content: loadPullRequestRule() }, { role: "user", content: `Prepare a PR description for ${issueKey}.\n\n${context.slice(0, 50_000)}` }] });
    if (response.status !== "completed" || !response.output_text.trim()) throw new Error(`Pull request preparation did not complete successfully (status: ${response.status}).`);
    return response.output_text.trim();
  }
}

export class PullRequestPreparationService {
  public constructor(private readonly store: WorkflowStore, private readonly writer: PullRequestWriter, private readonly artifactsRoot: string) {}

  public async run(idOrIssueKey: string): Promise<{ artifactPath: string }> {
    const workflow = this.store.find(idOrIssueKey); if (!workflow) throw new Error(`Workflow '${idOrIssueKey}' was not found.`);
    const running = markRunning(workflow, "PULL_REQUEST"); this.store.save(running);
    try {
      const directory = join(resolve(this.artifactsRoot), workflow.issueKey, workflow.id);
      const files = ["implementation-proposal.md", "code-review.md", "targeted-test-results.json"];
      const validationPath = join(directory, "targeted-test-results.json");
      assertPassingTargetedValidation(validationPath);
      const context = files.filter(file => existsSync(join(directory, file))).map(file => `## ${file}\n${readFileSync(join(directory, file), "utf8")}`).join("\n\n");
      const description = await this.writer.prepare(workflow.issueKey, context);
      mkdirSync(directory, { recursive: true });
      const artifactPath = join(directory, "pull-request-description.md"); writeFileSync(artifactPath, `${description}\n`);
      this.store.save(recoverWorkflow(running));
      return { artifactPath };
    } catch (error) { this.store.save(recoverWorkflow(running)); throw error; }
  }
}

function assertPassingTargetedValidation(path: string): void {
  if (!existsSync(path)) throw new Error("A passing targeted-test-results.json artifact is required before PR preparation.");
  let result: unknown;
  try { result = JSON.parse(readFileSync(path, "utf8")); } catch { throw new Error("targeted-test-results.json is malformed."); }
  if (typeof result !== "object" || result === null || !('passed' in result) || result.passed !== true) {
    throw new Error("PR preparation requires targeted-test-results.json with passed: true.");
  }
}
