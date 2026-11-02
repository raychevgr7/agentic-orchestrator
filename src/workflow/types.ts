export const workflowStages = [
  "ISSUE_ANALYSIS",
  "TEST_PLAN",
  "PROJECT_DISCOVERY",
  "CODE_CHANGE",
  "LOCAL_TESTS",
  "CODE_REVIEW",
  "PULL_REQUEST",
  "CI_ANALYSIS",
  "COMPLETE",
] as const;

export type WorkflowStage = (typeof workflowStages)[number];

export type WorkflowStatus = "PENDING_APPROVAL" | "RUNNING" | "REJECTED" | "COMPLETE";
export type ReviewVerdict = "APPROVE" | "REQUEST_CHANGES" | "BLOCKED";

export interface Workflow {
  id: string;
  issueKey: string;
  stage: WorkflowStage;
  status: WorkflowStatus;
  createdAt: string;
  updatedAt: string;
  feedback?: string;
  reviewVerdict?: ReviewVerdict;
  draftFingerprint?: string;
  reviewedDraftFingerprint?: string;
}
