import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import OpenAI from "openai";
import { loadCiAnalystRule } from "../agent-rules.js";
import { markRunning, recoverWorkflow } from "../workflow/lifecycle.js";
import type { WorkflowStore } from "../workflow/store.js";
import type { CiBuildReport, CiProvider } from "./provider.js";

export interface CiAnalyst { analyze(issueKey: string, report: CiBuildReport): Promise<string>; }

export class OpenAICiAnalyst implements CiAnalyst {
  public async analyze(issueKey: string, report: CiBuildReport): Promise<string> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new Error("OPENAI_API_KEY is missing. Add it only to your local .env file.");
    const response = await new OpenAI({ apiKey }).responses.create({
      model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini", max_output_tokens: 1_000, store: false,
      input: [{ role: "developer", content: loadCiAnalystRule() }, { role: "user", content: `Analyze CI build evidence for ${issueKey}.\n\n${JSON.stringify(report).slice(0, 60_000)}` }],
    });
    if (response.status !== "completed" || !response.output_text.trim()) throw new Error(`CI analysis did not complete successfully (status: ${response.status}).`);
    return response.output_text.trim();
  }
}

export class CiAnalysisService {
  public constructor(private readonly store: WorkflowStore, private readonly provider: CiProvider, private readonly analyst: CiAnalyst, private readonly artifactsRoot: string, private readonly jobPath: string) {}

  public async run(idOrIssueKey: string, buildNumber: string): Promise<{ artifactPath: string; status: CiBuildReport["status"] }> {
    if (!/^\d+$/.test(buildNumber) || Number(buildNumber) < 1) throw new Error("Jenkins build number must be a positive integer.");
    const workflow = this.store.find(idOrIssueKey);
    if (!workflow) throw new Error(`Workflow '${idOrIssueKey}' was not found.`);
    const running = markRunning(workflow, "CI_ANALYSIS");
    this.store.save(running);
    try {
      const report = await this.provider.getBuild(`${normalizedJobPath(this.jobPath)}/${buildNumber}`);
      const analysis = await this.analyst.analyze(workflow.issueKey, report);
      const directory = join(resolve(this.artifactsRoot), workflow.issueKey, workflow.id);
      mkdirSync(directory, { recursive: true });
      const artifactPath = join(directory, "ci-analysis.md");
      writeFileSync(artifactPath, `${analysis}\n`, "utf8");
      writeFileSync(join(directory, "ci-build-report.json"), JSON.stringify(report, null, 2), "utf8");
      this.store.save(recoverWorkflow(running));
      return { artifactPath, status: report.status };
    } catch (error) {
      this.store.save(recoverWorkflow(running));
      throw error;
    }
  }
}

function normalizedJobPath(value: string): string {
  const path = value.trim().replace(/^\/+|\/+$/g, "");
  if (!/^[A-Za-z0-9_./-]+$/.test(path) || path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("JENKINS_DEFAULT_JOB_PATH must be a relative Jenkins job path.");
  }
  return path;
}
