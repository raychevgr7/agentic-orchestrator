import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import OpenAI from "openai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadJiraAnalystRule } from "../agent-rules.js";
import { markRunning, recoverWorkflow } from "../workflow/lifecycle.js";
import type { WorkflowStore } from "../workflow/store.js";

export interface IssueReader { getIssue(issueKey: string): Promise<Record<string, unknown>>; }
export interface IssueAnalyst { analyze(issueKey: string, issue: Record<string, unknown>): Promise<string>; }
export interface JiraAnalysisOptions { includeParent?: boolean; includeSubtasks?: boolean; includeRelated?: boolean; }

export class McpJiraIssueReader implements IssueReader {
  public constructor(private readonly url: string) {}

  public async getIssue(issueKey: string): Promise<Record<string, unknown>> {
    const client = new Client({ name: "agentic-orchestrator", version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(new URL(this.url));
    try {
      await client.connect(transport);
      const result = await client.callTool({ name: "jira_get_issue", arguments: { issueKey } }) as { content: Array<{ type: string; text?: string }> };
      const text = result.content.find((item) => item.type === "text")?.text;
      if (!text) throw new Error("Jira MCP returned no readable issue data.");
      return JSON.parse(text) as Record<string, unknown>;
    } finally { await client.close(); }
  }
}

export class OpenAIJiraAnalyst implements IssueAnalyst {
  public async analyze(issueKey: string, issue: Record<string, unknown>): Promise<string> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new Error("OPENAI_API_KEY is missing. Add it only to your local .env file.");
    const response = await new OpenAI({ apiKey }).responses.create({
      model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini", max_output_tokens: 1_200, store: false,
      input: [{ role: "developer", content: loadJiraAnalystRule() }, { role: "user", content: `Analyze issue ${issueKey}. Treat this as compact source material; do not infer omitted details.\n\nJIRA ISSUE:\n${JSON.stringify(compactIssue(issue))}` }],
    });
    if (response.status !== "completed" || !response.output_text.trim()) throw new Error(`Jira analysis did not complete successfully (status: ${response.status}).`);
    return response.output_text.trim();
  }
}

export class JiraAnalysisService {
  public constructor(private readonly store: WorkflowStore, private readonly reader: IssueReader, private readonly analyst: IssueAnalyst, private readonly artifactsRoot: string) {}

  public async run(idOrIssueKey: string, options: JiraAnalysisOptions = {}): Promise<{ artifactPath: string }> {
    const workflow = this.store.find(idOrIssueKey);
    if (!workflow) throw new Error(`Workflow '${idOrIssueKey}' was not found.`);
    const running = markRunning(workflow, "ISSUE_ANALYSIS");
    this.store.save(running);
    try {
      const primaryIssue = await this.reader.getIssue(workflow.issueKey);
      const issue = await collectAnalysisContext(this.reader, primaryIssue, options);
      const report = await this.analyst.analyze(workflow.issueKey, issue);
      const directory = join(resolve(this.artifactsRoot), workflow.issueKey, workflow.id);
      mkdirSync(directory, { recursive: true });
      const artifactPath = join(directory, "issue-analysis.md");
      writeFileSync(artifactPath, `${report}\n`, "utf8");
      writeFileSync(join(directory, "issue-analysis-context.json"), JSON.stringify(compactIssue(issue), null, 2), "utf8");
      this.store.save(recoverWorkflow(running));
      return { artifactPath };
    } catch (error) {
      this.store.save(recoverWorkflow(running));
      throw error;
    }
  }
}

async function collectAnalysisContext(reader: IssueReader, primaryIssue: Record<string, unknown>, options: JiraAnalysisOptions): Promise<Record<string, unknown>> {
  const fields = record(primaryIssue.fields);
  const requested: Array<{ key: string; source: "parent" | "subtask" | "linked" }> = [];
  if (options.includeParent) {
    const key = stringValue(record(fields?.parent)?.key);
    if (key) requested.push({ key, source: "parent" });
  }
  if (options.includeSubtasks) {
    for (const subtask of array(fields?.subtasks)) {
      const key = stringValue(record(subtask)?.key);
      if (key) requested.push({ key, source: "subtask" });
    }
  }
  if (options.includeRelated) {
    for (const link of array(fields?.issuelinks)) {
      const linked = record(link);
      const key = stringValue(record(linked?.inwardIssue)?.key) ?? stringValue(record(linked?.outwardIssue)?.key);
      if (key) requested.push({ key, source: "linked" });
    }
  }
  const seen = new Set<string>([stringValue(primaryIssue.key) ?? ""]);
  const related = [] as Array<{ key: string; source: string; issue: Record<string, unknown> }>;
  for (const item of requested) {
    const key = item.key.toUpperCase();
    if (seen.has(key) || related.length >= 20) continue;
    seen.add(key);
    related.push({ key, source: item.source, issue: await reader.getIssue(key) });
  }
  return { primaryIssue, relatedIssues: related, scope: { includeParent: Boolean(options.includeParent), includeSubtasks: Boolean(options.includeSubtasks), includeRelated: Boolean(options.includeRelated) } };
}

function record(value: unknown): Record<string, unknown> | undefined { return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function stringValue(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value : undefined; }

function compactIssue(issue: Record<string, unknown>): Record<string, unknown> {
  const serialized = JSON.stringify(issue);
  return serialized.length <= 45_000 ? issue : { issueTruncated: true, content: serialized.slice(0, 45_000) };
}
