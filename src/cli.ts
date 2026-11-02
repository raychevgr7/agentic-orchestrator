import "dotenv/config";
import { resolve } from "node:path";
import { ChatService, OpenAIActionInterpreter } from "./chat.js";
import { JiraAnalysisService, McpJiraIssueReader, OpenAIJiraAnalyst } from "./agents/jira-analyst.js";
import { OpenAITestPlanner, TestDesignService } from "./agents/test-designer.js";
import { AutomationDiscoveryService, McpProjectDiscoverer, OpenAIAutomationDecider } from "./agents/automation-designer.js";
import { EngineerPlanningService, OpenAIEngineerPlanner } from "./agents/engineer.js";
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
    case "chat": {
      const message = process.argv.slice(3).join(" ");
      const analysisService = new JiraAnalysisService(store, new McpJiraIssueReader(process.env.JIRA_MCP_URL ?? "http://127.0.0.1:3001/mcp"), new OpenAIJiraAnalyst(), process.env.WORKFLOW_ARTIFACTS_PATH ?? "./data/artifacts");
      const testDesignService = new TestDesignService(store, new OpenAITestPlanner(), process.env.WORKFLOW_ARTIFACTS_PATH ?? "./data/artifacts");
      const discoveryService = new AutomationDiscoveryService(store, new McpProjectDiscoverer(process.env.PROJECT_MCP_URL ?? "http://127.0.0.1:3002/mcp"), new OpenAIAutomationDecider(), process.env.WORKFLOW_ARTIFACTS_PATH ?? "./data/artifacts");
      const chat = new ChatService(store, new OpenAIActionInterpreter(), {
        analyzeIssue: async (issueKey) => {
          const result = await analysisService.run(issueKey);
          return `Issue analysis saved to ${result.artifactPath}.`;
        },
        designTests: async (issueKey) => {
          const result = await testDesignService.run(issueKey);
          return `Test plan saved to ${result.artifactPath}.`;
        },
        discoverAutomation: async (issueKey) => {
          const result = await discoveryService.run(issueKey);
          return `Automation decision saved to ${result.artifactPath}.`;
        },
      });
      console.log(await chat.respond(message));
      break;
    }
    case "design": {
      const service = new TestDesignService(store, new OpenAITestPlanner(), process.env.WORKFLOW_ARTIFACTS_PATH ?? "./data/artifacts");
      const result = await service.run(required(identifier, "workflow ID or issue key"));
      console.log(`Test plan saved to ${result.artifactPath}.`); break;
    }
    case "discover": {
      const service = new AutomationDiscoveryService(store, new McpProjectDiscoverer(process.env.PROJECT_MCP_URL ?? "http://127.0.0.1:3002/mcp"), new OpenAIAutomationDecider(), process.env.WORKFLOW_ARTIFACTS_PATH ?? "./data/artifacts");
      const result = await service.run(required(identifier, "workflow ID or issue key"));
      console.log(`Automation decision saved to ${result.artifactPath}.`); break;
    }
    case "propose": {
      const service = new EngineerPlanningService(store, new OpenAIEngineerPlanner(), process.env.WORKFLOW_ARTIFACTS_PATH ?? "./data/artifacts");
      const result = await service.run(required(identifier, "workflow ID or issue key"));
      console.log(`Implementation proposal saved to ${result.artifactPath}.`); break;
    }
    case "analyze": {
      const service = new JiraAnalysisService(store, new McpJiraIssueReader(process.env.JIRA_MCP_URL ?? "http://127.0.0.1:3001/mcp"), new OpenAIJiraAnalyst(), process.env.WORKFLOW_ARTIFACTS_PATH ?? "./data/artifacts");
      const result = await service.run(required(identifier, "workflow ID or issue key"), { includeParent: process.argv.includes("--with-parent"), includeSubtasks: process.argv.includes("--with-subtasks"), includeRelated: process.argv.includes("--with-related") });
      console.log(`Issue analysis saved to ${result.artifactPath}.`);
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
  console.error("Usage: npm run workflow -- start|analyze|design|discover|propose|status|approve|recover|feedback <issue-key-or-id> [stage|message] | chat <free text>\n  analyze options: --with-parent --with-subtasks --with-related");
}
