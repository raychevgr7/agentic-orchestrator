import { resolve } from "node:path";
import { addFeedback, approveStage, createWorkflow, recoverWorkflow } from "./workflow/lifecycle.js";
import { SqliteWorkflowStore } from "./workflow/store.js";
import { workflowStages, type WorkflowStage } from "./workflow/types.js";

const databasePath = resolve(process.env.WORKFLOW_DATA_PATH ?? "./data", "workflows.db");
const store = new SqliteWorkflowStore(databasePath);
const [command, identifier, argument] = process.argv.slice(2);

try {
  switch (command) {
    case "start": {
      const workflow = createWorkflow(required(identifier, "issue key"));
      store.create(workflow);
      print(workflow);
      break;
    }
    case "status":
      print(find(required(identifier, "workflow ID or issue key")));
      break;
    case "approve": {
      const workflow = find(required(identifier, "workflow ID or issue key"));
      const stage = requiredStage(argument);
      const updated = approveStage(workflow, stage);
      store.save(updated);
      print(updated);
      break;
    }
    case "recover": {
      const workflow = find(required(identifier, "workflow ID or issue key"));
      const updated = recoverWorkflow(workflow);
      store.save(updated);
      print(updated);
      break;
    }
    case "feedback": {
      const workflow = find(required(identifier, "workflow ID or issue key"));
      const message = process.argv.slice(4).join(" ");
      const updated = addFeedback(workflow, message);
      store.save(updated);
      print(updated);
      break;
    }
    default:
      usage();
      process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  store.close();
}

function find(idOrIssueKey: string) {
  const workflow = store.find(idOrIssueKey);
  if (!workflow) throw new Error(`Workflow '${idOrIssueKey}' was not found.`);
  return workflow;
}

function required(value: string | undefined, description: string): string {
  if (!value?.trim()) throw new Error(`Missing ${description}.`);
  return value;
}

function requiredStage(value: string | undefined): WorkflowStage {
  if (!value || !workflowStages.includes(value as WorkflowStage)) {
    throw new Error(`Stage must be one of: ${workflowStages.join(", ")}.`);
  }
  return value as WorkflowStage;
}

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function usage(): void {
  console.error("Usage: npm run workflow -- start|status|approve|recover|feedback <issue-key-or-id> [stage|message]");
}
