import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import OpenAI from "openai";
import { loadCodeReviewerRule } from "../agent-rules.js";
import { draftFingerprint, type StagedTestDraft } from "../code-changes/staged-draft.js";
import { markRunning, recoverWorkflow, returnForCodeChanges } from "../workflow/lifecycle.js";
import type { ReviewVerdict } from "../workflow/types.js";
import type { WorkflowStore } from "../workflow/store.js";

export interface CodeReviewer { review(context: string): Promise<string>; }
export class OpenAICodeReviewer implements CodeReviewer {
  public async review(context: string): Promise<string> { const key = process.env.OPENAI_API_KEY?.trim(); if (!key) throw new Error("OPENAI_API_KEY is missing."); const r = await new OpenAI({ apiKey: key }).responses.create({ model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini", max_output_tokens: 1200, store: false, input: [{ role: "developer", content: loadCodeReviewerRule() }, { role: "user", content: context.slice(0, 60000) }] }); return r.output_text.trim(); }
}
export class CodeReviewService {
  public constructor(private readonly store: WorkflowStore, private readonly reviewer: CodeReviewer, private readonly artifactsRoot: string) {}
  public async run(id: string): Promise<{ artifactPath: string; verdict: ReviewVerdict }> { const w = this.store.find(id); if (!w) throw new Error(`Workflow '${id}' was not found.`); const running = markRunning(w, "CODE_REVIEW"); this.store.save(running); try { const dir = join(resolve(this.artifactsRoot), w.issueKey, w.id); const files = ["implementation-proposal.md", "staged-test-draft.json", "test-plan.md", "automation-decision.md"]; const context = files.filter(x => existsSync(join(dir, x))).map(x => `## ${x}\n${readFileSync(join(dir, x), "utf8")}`).join("\n\n"); if (!context) throw new Error("No review artifacts were found."); const draftPath = join(dir, "staged-test-draft.json"); if (!existsSync(draftPath)) throw new Error("CODE_REVIEW requires a staged test draft."); const draft = JSON.parse(readFileSync(draftPath, "utf8")) as StagedTestDraft; const currentDraftFingerprint = draftFingerprint(draft); const report = await this.reviewer.review(context); const verdict = parseVerdict(report); mkdirSync(dir, { recursive: true }); const artifactPath = join(dir, "code-review.md"); writeFileSync(artifactPath, report + "\n"); if (verdict === "APPROVE") this.store.save({ ...recoverWorkflow(running), reviewVerdict: verdict, draftFingerprint: currentDraftFingerprint, reviewedDraftFingerprint: currentDraftFingerprint }); else this.store.save({ ...returnForCodeChanges(running, `Code review returned ${verdict}; inspect code-review.md and update the draft.`), reviewVerdict: verdict, draftFingerprint: currentDraftFingerprint, reviewedDraftFingerprint: currentDraftFingerprint }); return { artifactPath, verdict }; } catch (e) { this.store.save(recoverWorkflow(running)); throw e; } }
}
function parseVerdict(report: string): ReviewVerdict { const match = report.match(/## Verdict\s*\n\s*(APPROVE|REQUEST_CHANGES|BLOCKED)\b/i); if (!match) throw new Error("Code review did not return a valid verdict."); return match[1]!.toUpperCase() as ReviewVerdict; }
