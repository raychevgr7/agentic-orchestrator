export type CiBuildStatus = "SUCCESS" | "FAILURE" | "RUNNING" | "ABORTED" | "UNKNOWN";

export interface CiBuildReport {
  provider: string;
  reference: string;
  status: CiBuildStatus;
  buildUrl: string;
  startedAt?: string;
  finishedAt?: string;
  logs: string;
  testResults: { total: number; failed: number; skipped: number };
}

export interface CiProvider { getBuild(reference: string): Promise<CiBuildReport>; }
