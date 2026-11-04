import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import OpenAI from "openai";
import { loadCodeReviewerRule } from "../agent-rules.js";
import { boundedTokenBudget, openAIModel, openAIReasoningEffort } from "../core/openai-config.js";
import { draftFingerprint, type StagedTestDraft } from "../code-changes/staged-draft.js";
import { markRunning, recoverWorkflow, returnForCodeChanges } from "../workflow/lifecycle.js";
import type { ReviewVerdict } from "../workflow/types.js";
import type { WorkflowStore } from "../workflow/store.js";

export interface CodeReviewer { review(context: string): Promise<string>; }
export class OpenAICodeReviewer implements CodeReviewer {
  public async review(context: string): Promise<string> { const key = process.env.OPENAI_API_KEY?.trim(); if (!key) throw new Error("OPENAI_API_KEY is missing."); const r = await new OpenAI({ apiKey: key }).responses.create({ model: openAIModel(), reasoning: { effort: openAIReasoningEffort() }, max_output_tokens: boundedTokenBudget("CODE_REVIEW_MAX_OUTPUT_TOKENS", 1_200, 500, 3_000), store: false, input: [{ role: "developer", content: loadCodeReviewerRule() }, { role: "user", content: context.slice(0, 60000) }] }); return r.output_text.trim(); }
}
export class CodeReviewService {
  public constructor(private readonly store: WorkflowStore, private readonly reviewer: CodeReviewer, private readonly artifactsRoot: string, private readonly projectRoot?: string, private readonly baseBranch = process.env.PROJECT_BASE_BRANCH?.trim() || "master") {}
  public async run(id: string): Promise<{ artifactPath: string; verdict: ReviewVerdict }> { const w = this.store.find(id); if (!w) throw new Error(`Workflow '${id}' was not found.`); const running = markRunning(w, "CODE_REVIEW"); this.store.save(running); try { const dir = join(resolve(this.artifactsRoot), w.issueKey, w.id); const files = ["implementation-proposal.md", "staged-test-draft.json", "test-plan.md", "automation-decision.md", "targeted-test-results.json"]; const context = files.filter(x => existsSync(join(dir, x))).map(x => `## ${x}\n${readFileSync(join(dir, x), "utf8")}`).join("\n\n") + gitDiff(this.projectRoot, this.baseBranch); if (!context) throw new Error("No review artifacts were found."); const draftPath = join(dir, "staged-test-draft.json"); if (!existsSync(draftPath)) throw new Error("CODE_REVIEW requires a staged test draft."); const draft = JSON.parse(readFileSync(draftPath, "utf8")) as StagedTestDraft; const currentDraftFingerprint = draftFingerprint(draft); const report = await this.reviewer.review(context); const verdict = parseVerdict(report); mkdirSync(dir, { recursive: true }); const artifactPath = join(dir, "code-review.md"); writeFileSync(artifactPath, report + "\n"); if (verdict === "APPROVE") this.store.save({ ...recoverWorkflow(running), reviewVerdict: verdict, draftFingerprint: currentDraftFingerprint, reviewedDraftFingerprint: currentDraftFingerprint }); else this.store.save({ ...returnForCodeChanges(running, `Code review returned ${verdict}; inspect code-review.md and update the draft.`), reviewVerdict: verdict, draftFingerprint: currentDraftFingerprint, reviewedDraftFingerprint: currentDraftFingerprint }); return { artifactPath, verdict }; } catch (e) { this.store.save(recoverWorkflow(running)); throw e; } }
}
function gitDiff(projectRoot: string | undefined, baseBranch: string): string {
  if (!projectRoot) return "";
  const committed = git(projectRoot, ["diff", "--merge-base", baseBranch, "HEAD", "--", "."]);
  const staged = git(projectRoot, ["diff", "--cached", "--", "."]);
  const working = git(projectRoot, ["diff", "--", "."]);
  const diff = [committed, staged, working].filter(Boolean).join("\n");
  return `\n\n## Actual Git diff against ${baseBranch}\n${diff ? diff.slice(0, 30_000) : "No changes found against the base branch."}`;
}
function git(projectRoot: string, args: string[]): string { const result = spawnSync("git", args, { cwd: projectRoot, encoding: "utf8" }); if (result.status !== 0) throw new Error(result.stderr.trim() || "Unable to read Git diff for code review."); return result.stdout; }
function parseVerdict(report: string): ReviewVerdict { const match = report.match(/## Verdict\s*\n\s*(APPROVE|REQUEST_CHANGES|BLOCKED)\b/i); if (!match) throw new Error("Code review did not return a valid verdict."); return match[1]!.toUpperCase() as ReviewVerdict; }
