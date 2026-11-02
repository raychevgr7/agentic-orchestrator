import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { Workflow, WorkflowStage, WorkflowStatus } from "./types.js";

export interface WorkflowStore {
  create(workflow: Workflow): void;
  find(idOrIssueKey: string): Workflow | undefined;
  save(workflow: Workflow): void;
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
    `);
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
      SET stage = @stage, status = @status, updated_at = @updatedAt, feedback = @feedback
      WHERE id = @id
    `).run({ ...workflow, feedback: workflow.feedback ?? null });
    if (result.changes !== 1) throw new Error(`Workflow '${workflow.id}' was not found.`);
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
  };
}
