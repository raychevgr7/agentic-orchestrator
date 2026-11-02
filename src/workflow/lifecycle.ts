import { workflowStages, type Workflow, type WorkflowStage } from "./types.js";

export function createWorkflow(issueKey: string, now = new Date()): Workflow {
  assertIssueKey(issueKey);
  const timestamp = now.toISOString();
  return {
    id: `${issueKey.toUpperCase()}-${now.getTime()}`,
    issueKey: issueKey.toUpperCase(),
    stage: "ISSUE_ANALYSIS",
    status: "PENDING_APPROVAL",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function approveStage(workflow: Workflow, expectedStage: WorkflowStage, now = new Date()): Workflow {
  if (workflow.status !== "PENDING_APPROVAL" || workflow.stage !== expectedStage) {
    throw new Error(`Workflow is waiting at ${workflow.stage}, not ${expectedStage}.`);
  }

  const currentIndex = workflowStages.indexOf(workflow.stage);
  const stage = workflowStages[currentIndex + 1] ?? "COMPLETE";
  return updated(workflow, stage, stage === "COMPLETE" ? "COMPLETE" : "PENDING_APPROVAL", now);
}

export function markRunning(workflow: Workflow, expectedStage: WorkflowStage, now = new Date()): Workflow {
  if (workflow.status !== "PENDING_APPROVAL" || workflow.stage !== expectedStage) {
    throw new Error(`Workflow must be waiting at ${expectedStage}; it is ${workflow.status} at ${workflow.stage}.`);
  }
  return updated(workflow, workflow.stage, "RUNNING", now);
}

export function recoverWorkflow(workflow: Workflow, now = new Date()): Workflow {
  if (workflow.status !== "RUNNING") {
    throw new Error(`Workflow is ${workflow.status}; only a stale RUNNING workflow can be recovered.`);
  }
  return updated(workflow, workflow.stage, "PENDING_APPROVAL", now);
}

export function addFeedback(workflow: Workflow, feedback: string, now = new Date()): Workflow {
  const message = feedback.trim();
  if (!message) throw new Error("Feedback cannot be empty.");
  return { ...updated(workflow, workflow.stage, "PENDING_APPROVAL", now), feedback: message };
}

function updated(workflow: Workflow, stage: WorkflowStage, status: Workflow["status"], now: Date): Workflow {
  return { ...workflow, stage, status, updatedAt: now.toISOString() };
}

function assertIssueKey(issueKey: string): void {
  if (!/^[A-Z][A-Z0-9]+-\d+$/i.test(issueKey)) {
    throw new Error("Issue key must look like PROJECT-123.");
  }
}
