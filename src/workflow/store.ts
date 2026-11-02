import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { Workflow, WorkflowStage, WorkflowStatus, ReviewVerdict } from "./types.js";

export interface PendingAction {
  kind: string;
  issueKey?: string;
  stage?: string;
  feedback?: string;
  testTarget?: string;
  ciBuildNumber?: string;
  explanation: string;
}

export interface WorkflowStore {
  create(workflow: Workflow): void;
  find(idOrIssueKey: string): Workflow | undefined;
  save(workflow: Workflow): void;
  savePendingAction(action: PendingAction): void;
  getPendingAction(): PendingAction | undefined;
  clearPendingAction(): void;
  close(): void;
}

export class SqliteWorkflowStore implements WorkflowStore {
  private readonly database: Database.Database;

  public constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new Database(databasePath);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS workflows (
        id TEXT PRIMARY KEY,
        issue_key TEXT NOT NULL,
        stage TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        feedback TEXT
      );
      CREATE INDEX IF NOT EXISTS workflows_issue_key_created_at
        ON workflows (issue_key, created_at DESC);
      CREATE TABLE IF NOT EXISTS pending_actions (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        action_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    for (const statement of [
      "ALTER TABLE workflows ADD COLUMN review_verdict TEXT",
      "ALTER TABLE workflows ADD COLUMN draft_fingerprint TEXT",
      "ALTER TABLE workflows ADD COLUMN reviewed_draft_fingerprint TEXT",
    ]) {
      try { this.database.exec(statement); } catch { /* existing database already migrated */ }
    }
  }

  public create(workflow: Workflow): void {
    this.database.prepare(`
      INSERT INTO workflows (id, issue_key, stage, status, created_at, updated_at, feedback)
      VALUES (@id, @issueKey, @stage, @status, @createdAt, @updatedAt, @feedback)
    `).run({ ...workflow, feedback: workflow.feedback ?? null });
  }

  public find(idOrIssueKey: string): Workflow | undefined {
    const row = this.database.prepare(`
      SELECT * FROM workflows
      WHERE id = ? OR issue_key = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(idOrIssueKey, idOrIssueKey.toUpperCase()) as WorkflowRow | undefined;
    return row ? mapWorkflow(row) : undefined;
  }

  public save(workflow: Workflow): void {
    const result = this.database.prepare(`
      UPDATE workflows
      SET stage = @stage, status = @status, updated_at = @updatedAt, feedback = @feedback,
        review_verdict = @reviewVerdict, draft_fingerprint = @draftFingerprint,
        reviewed_draft_fingerprint = @reviewedDraftFingerprint
      WHERE id = @id
    `).run({ ...workflow, feedback: workflow.feedback ?? null, reviewVerdict: workflow.reviewVerdict ?? null,
      draftFingerprint: workflow.draftFingerprint ?? null, reviewedDraftFingerprint: workflow.reviewedDraftFingerprint ?? null });
    if (result.changes !== 1) throw new Error(`Workflow '${workflow.id}' was not found.`);
  }

  public savePendingAction(action: PendingAction): void {
    this.database.prepare(`
      INSERT INTO pending_actions (id, action_json, created_at) VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET action_json = excluded.action_json, created_at = excluded.created_at
    `).run(JSON.stringify(action), new Date().toISOString());
  }

  public getPendingAction(): PendingAction | undefined {
    const row = this.database.prepare("SELECT action_json FROM pending_actions WHERE id = 1")
      .get() as { action_json: string } | undefined;
    if (!row) return undefined;
    return JSON.parse(row.action_json) as PendingAction;
  }

  public clearPendingAction(): void {
    this.database.prepare("DELETE FROM pending_actions WHERE id = 1").run();
  }

  public close(): void {
    this.database.close();
  }
}

interface WorkflowRow {
  id: string;
  issue_key: string;
  stage: WorkflowStage;
  status: WorkflowStatus;
  created_at: string;
  updated_at: string;
  feedback: string | null;
  review_verdict?: ReviewVerdict | null;
  draft_fingerprint?: string | null;
  reviewed_draft_fingerprint?: string | null;
}

function mapWorkflow(row: WorkflowRow): Workflow {
  return {
    id: row.id,
    issueKey: row.issue_key,
    stage: row.stage,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    feedback: row.feedback ?? undefined,
    reviewVerdict: row.review_verdict ?? undefined,
    draftFingerprint: row.draft_fingerprint ?? undefined,
    reviewedDraftFingerprint: row.reviewed_draft_fingerprint ?? undefined,
  };
}
