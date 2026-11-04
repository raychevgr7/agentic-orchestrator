import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import OpenAI from "openai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadAutomationDesignerRule } from "../agent-rules.js";
import { boundedTokenBudget, openAIModel, openAIReasoningEffort } from "../core/openai-config.js";
import { markRunning, recoverWorkflow } from "../workflow/lifecycle.js";
import type { WorkflowStore } from "../workflow/store.js";

export interface ProjectDiscoverer { discover(plan: string): Promise<Record<string, unknown>>; }
export interface AutomationDecider { decide(issueKey: string, plan: string, discovery: Record<string, unknown>): Promise<string>; }
export class McpProjectDiscoverer implements ProjectDiscoverer {
  public constructor(private readonly url: string) {}
  public async discover(plan: string): Promise<Record<string, unknown>> {
    const queries = [...new Set((plan.match(/[A-Za-z][A-Za-z0-9-]{2,}/g) ?? []).map(x => x.toLowerCase()).filter(x => !["test", "scope", "risks", "open"].includes(x)))].slice(0, 8);
    const client = new Client({ name: "agentic-orchestrator", version: "0.1.0" }); const transport = new StreamableHTTPClientTransport(new URL(this.url));
    try { await client.connect(transport); return { queries, tests: await call(client, "project_list_tests", {}), relevantFiles: await call(client, "project_find_relevant_files", { queries: queries.length ? queries : ["test"], maxResults: 8 }) }; } finally { await client.close(); }
  }
}
export class OpenAIAutomationDecider implements AutomationDecider {
  public async decide(issueKey: string, plan: string, discovery: Record<string, unknown>): Promise<string> {
    const apiKey = process.env.OPENAI_API_KEY?.trim(); if (!apiKey) throw new Error("OPENAI_API_KEY is missing. Add it only to your local .env file.");
    const response = await new OpenAI({ apiKey }).responses.create({ model: openAIModel(), reasoning: { effort: openAIReasoningEffort() }, max_output_tokens: boundedTokenBudget("AUTOMATION_DISCOVERY_MAX_OUTPUT_TOKENS", 2_200, 500, 3_000), store: false, input: [{ role: "developer", content: loadAutomationDesignerRule() }, { role: "user", content: `Decide Playwright automation scope for ${issueKey}.\n\nTEST PLAN:\n${plan.slice(0, 30_000)}\n\nPROJECT DISCOVERY:\n${JSON.stringify(discovery).slice(0, 30_000)}` }] });
    if (response.status !== "completed" || !response.output_text.trim()) throw new Error(`Automation decision did not complete successfully (status: ${response.status}).`); return response.output_text.trim();
  }
}
export class AutomationDiscoveryService {
  public constructor(private readonly store: WorkflowStore, private readonly discoverer: ProjectDiscoverer, private readonly decider: AutomationDecider, private readonly artifactsRoot: string) {}
  public async run(idOrIssueKey: string): Promise<{ artifactPath: string }> {
    const workflow = this.store.find(idOrIssueKey); if (!workflow) throw new Error(`Workflow '${idOrIssueKey}' was not found.`); const running = markRunning(workflow, "PROJECT_DISCOVERY"); this.store.save(running);
    try { const directory = join(resolve(this.artifactsRoot), workflow.issueKey, workflow.id); const planPath = join(directory, "test-plan.md"); if (!existsSync(planPath)) throw new Error("Test plan artifact was not found. Complete TEST_PLAN first."); const plan = readFileSync(planPath, "utf8"); const discovery = await this.discoverer.discover(plan); const decision = await this.decider.decide(workflow.issueKey, plan, discovery); mkdirSync(directory, { recursive: true }); const artifactPath = join(directory, "automation-decision.md"); writeFileSync(artifactPath, `${decision}\n`); writeFileSync(join(directory, "project-discovery-context.json"), JSON.stringify(discovery, null, 2)); this.store.save(recoverWorkflow(running)); return { artifactPath }; } catch (error) { this.store.save(recoverWorkflow(running)); throw error; }
  }
}
async function call(client: Client, name: string, args: Record<string, unknown>): Promise<unknown> { const result = await client.callTool({ name, arguments: args }) as { content: Array<{ type: string; text?: string }> }; const text = result.content.find(x => x.type === "text")?.text; if (!text) throw new Error(`Project MCP returned no readable content for ${name}.`); return JSON.parse(text); }
