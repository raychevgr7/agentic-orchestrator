import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { ApprovedTestWriter } from "../project-mcp/writer.js";

export interface StagedTestDraft { path: string; content: string; }

export function stageDraft(artifactsRoot: string, issueKey: string, workflowId: string, draft: StagedTestDraft): string {
  const path = join(resolve(artifactsRoot), issueKey, workflowId, "staged-test-draft.json");
  mkdirSync(join(resolve(artifactsRoot), issueKey, workflowId), { recursive: true });
  writeFileSync(path, JSON.stringify(draft, null, 2), "utf8"); return path;
}

export function draftFingerprint(draft: StagedTestDraft): string {
  return createHash("sha256").update(JSON.stringify(draft)).digest("hex");
}

export function previewDraft(projectRoot: string, draft: StagedTestDraft): string {
  const target = new ApprovedTestWriter(projectRoot).target(draft.path);
  const before = existsSync(target) ? readFileSync(target, "utf8") : "";
  return `--- ${draft.path}\n+++ ${draft.path}\n${before ? `- existing file (${before.length} chars)\n` : "- new file\n"}+ proposed content (${draft.content.length} chars)\n`;
}

export function applyDraft(projectRoot: string, draft: StagedTestDraft): void { new ApprovedTestWriter(projectRoot).write(draft.path, draft.content); }

export function markDraftPreviewed(artifactsRoot: string, issueKey: string, workflowId: string, draft: StagedTestDraft): void {
  writeFileSync(join(resolve(artifactsRoot), issueKey, workflowId, "staged-test-draft.preview"), fingerprint(draft), "utf8");
}
export function wasDraftPreviewed(artifactsRoot: string, issueKey: string, workflowId: string, draft: StagedTestDraft): boolean {
  const marker = join(resolve(artifactsRoot), issueKey, workflowId, "staged-test-draft.preview");
  return existsSync(marker) && readFileSync(marker, "utf8") === fingerprint(draft);
}
const fingerprint = draftFingerprint;
