import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolve } from "node:path";
import { ChatService, OpenAIActionInterpreter } from "./chat.js";
import { JiraAnalysisService, McpJiraIssueReader, OpenAIJiraAnalyst } from "./agents/jira-analyst.js";
import { OpenAITestPlanner, TestDesignService } from "./agents/test-designer.js";
import { AutomationDiscoveryService, McpProjectDiscoverer, OpenAIAutomationDecider } from "./agents/automation-designer.js";
import { EngineerPlanningService, OpenAIEngineerPlanner } from "./agents/engineer.js";
import { OpenAIEngineerDraftGenerator } from "./agents/engineer.js";
import { CodeReviewService, OpenAICodeReviewer } from "./agents/code-reviewer.js";
import { OpenAIPullRequestWriter, PullRequestPreparationService } from "./agents/pull-request.js";
import { CiAnalysisService, OpenAICiAnalyst } from "./ci/ci-analysis.js";
import { JenkinsCiProvider } from "./ci/jenkins-provider.js";
import { LocalTestsService } from "./testing/local-tests.js";
import { applyDraft, draftFingerprint, markDraftPreviewed, previewDraft, stageDraft, type StagedTestDraft, wasDraftPreviewed } from "./code-changes/staged-draft.js";
import { FeatureBranchService } from "./code-changes/git-branch.js";
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
      const codeReviewService = new CodeReviewService(store, new OpenAICodeReviewer(), process.env.WORKFLOW_ARTIFACTS_PATH ?? "./data/artifacts", process.env.PROJECT_SOURCE_ROOT);
      const pullRequestService = new PullRequestPreparationService(store, new OpenAIPullRequestWriter(), process.env.WORKFLOW_ARTIFACTS_PATH ?? "./data/artifacts");
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
        generateDraft: async (issueKey) => generateDraftForWorkflow(find(issueKey)),
        previewDraft: async (issueKey) => previewDraftForWorkflow(find(issueKey)),
        applyDraft: async (issueKey) => applyDraftForWorkflow(find(issueKey)),
        reviewCode: async (issueKey) => {
          const result = await codeReviewService.run(issueKey);
          return `Code review ${result.verdict}: ${result.artifactPath}.`;
        },
        verifyTests: async (issueKey, testTarget) => {
          const result = await new LocalTestsService(store, process.env.WORKFLOW_ARTIFACTS_PATH ?? "./data/artifacts").run(issueKey, testTarget);
          return `Targeted test validation ${result.passed ? "passed" : "failed"}: ${result.artifactPath}`;
        },
        preparePullRequest: async (issueKey) => {
          const result = await pullRequestService.run(issueKey);
          return `Pull request description saved to ${result.artifactPath}.`;
        },
        analyzeCi: async (issueKey, buildNumber) => {
          const { provider, jobPath } = jenkinsFromEnvironment();
          const result = await new CiAnalysisService(store, provider, new OpenAICiAnalyst(), process.env.WORKFLOW_ARTIFACTS_PATH ?? "./data/artifacts", jobPath).run(issueKey, buildNumber);
          return `CI analysis (${result.status}) saved to ${result.artifactPath}.`;
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
    case "verify": {
      const service = new LocalTestsService(store, process.env.WORKFLOW_ARTIFACTS_PATH ?? "./data/artifacts");
      const result = await service.run(required(identifier, "workflow ID or issue key"), required(argument, "test target"));
      console.log(`Targeted test validation ${result.passed ? "passed" : "failed"}: ${result.artifactPath}`); if (!result.passed) process.exitCode = 1; break;
    }
    case "stage-draft": {
      const workflow = find(required(identifier, "workflow ID or issue key"));
      const testPath = required(argument, "test file path"); const contentFile = required(process.argv[4], "draft content file");
      const draft = { path: testPath, content: readFileSync(contentFile, "utf8") };
      const artifactPath = stageDraft(process.env.WORKFLOW_ARTIFACTS_PATH ?? "./data/artifacts", workflow.issueKey, workflow.id, draft);
      store.save({ ...workflow, reviewVerdict: undefined, draftFingerprint: draftFingerprint(draft), reviewedDraftFingerprint: undefined, updatedAt: new Date().toISOString() });
      console.log(`Staged draft saved to ${artifactPath}.`); break;
    }
    case "generate-draft": {
      console.log(await generateDraftForWorkflow(find(required(identifier, "workflow ID or issue key")))); break;
    }
    case "review": {
      const service = new CodeReviewService(store, new OpenAICodeReviewer(), process.env.WORKFLOW_ARTIFACTS_PATH ?? "./data/artifacts", process.env.PROJECT_SOURCE_ROOT);
      const result = await service.run(required(identifier, "workflow ID or issue key")); console.log(`Code review ${result.verdict}: ${result.artifactPath}`); break;
    }
    case "prepare-pr": {
      const service = new PullRequestPreparationService(store, new OpenAIPullRequestWriter(), process.env.WORKFLOW_ARTIFACTS_PATH ?? "./data/artifacts");
      const result = await service.run(required(identifier, "workflow ID or issue key")); console.log(`Pull request description saved to ${result.artifactPath}.`); break;
    }
    case "preview-draft": {
      console.log(previewDraftForWorkflow(find(required(identifier, "workflow ID or issue key")))); break;
    }
    case "apply-draft": {
      if (!process.argv.includes("--confirm")) throw new Error("Preview the draft first, then rerun with --confirm to apply it.");
      console.log(applyDraftForWorkflow(find(required(identifier, "workflow ID or issue key")))); break;
    }
    case "analyze": {
      const service = new JiraAnalysisService(store, new McpJiraIssueReader(process.env.JIRA_MCP_URL ?? "http://127.0.0.1:3001/mcp"), new OpenAIJiraAnalyst(), process.env.WORKFLOW_ARTIFACTS_PATH ?? "./data/artifacts");
      const result = await service.run(required(identifier, "workflow ID or issue key"), { includeParent: process.argv.includes("--with-parent"), includeSubtasks: process.argv.includes("--with-subtasks"), includeRelated: process.argv.includes("--with-related") });
      console.log(`Issue analysis saved to ${result.artifactPath}.`);
      break;
    }
    case "analyze-ci": {
      const { provider, jobPath } = jenkinsFromEnvironment();
      const result = await new CiAnalysisService(store, provider, new OpenAICiAnalyst(), process.env.WORKFLOW_ARTIFACTS_PATH ?? "./data/artifacts", jobPath)
        .run(required(identifier, "workflow ID or issue key"), required(argument, "Jenkins build number"));
      console.log(`CI analysis (${result.status}) saved to ${result.artifactPath}.`); break;
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
  console.error("Usage: npm run workflow -- start|analyze|design|discover|propose|generate-draft|review|prepare-pr|analyze-ci|verify|stage-draft|preview-draft|apply-draft|status|approve|recover|feedback <issue-key-or-id> [stage|message] | chat <free text>\n  analyze options: --with-parent --with-subtasks --with-related");
}

function jenkinsFromEnvironment(): { provider: JenkinsCiProvider; jobPath: string } {
  return { provider: new JenkinsCiProvider({
    baseUrl: required(process.env.JENKINS_BASE_URL, "JENKINS_BASE_URL"),
    username: required(process.env.JENKINS_USERNAME, "JENKINS_USERNAME"),
    apiToken: required(process.env.JENKINS_API_TOKEN, "JENKINS_API_TOKEN"),
  }), jobPath: required(process.env.JENKINS_DEFAULT_JOB_PATH, "JENKINS_DEFAULT_JOB_PATH") };
}

function loadDraft(issueKey: string, workflowId: string): StagedTestDraft {
  const path = join(resolve(process.env.WORKFLOW_ARTIFACTS_PATH ?? "./data/artifacts"), issueKey, workflowId, "staged-test-draft.json");
  return JSON.parse(readFileSync(path, "utf8")) as StagedTestDraft;
}

async function generateDraftForWorkflow(workflow: ReturnType<typeof find>): Promise<string> {
  if (workflow.stage !== "CODE_CHANGE" || workflow.status !== "PENDING_APPROVAL") {
    throw new Error("Draft generation is available only while CODE_CHANGE is waiting for approval.");
  }
  const root = process.env.WORKFLOW_ARTIFACTS_PATH ?? "./data/artifacts";
  const proposal = readFileSync(join(resolve(root), workflow.issueKey, workflow.id, "implementation-proposal.md"), "utf8");
  const draft = await new OpenAIEngineerDraftGenerator().generate(proposal);
  const artifactPath = stageDraft(root, workflow.issueKey, workflow.id, draft);
  store.save({ ...workflow, reviewVerdict: undefined, draftFingerprint: draftFingerprint(draft), reviewedDraftFingerprint: undefined, updatedAt: new Date().toISOString() });
  return `Staged draft saved to ${artifactPath}.`;
}

function previewDraftForWorkflow(workflow: ReturnType<typeof find>): string {
  const draft = loadDraft(workflow.issueKey, workflow.id);
  const output = previewDraft(required(process.env.PROJECT_SOURCE_ROOT, "PROJECT_SOURCE_ROOT"), draft);
  markDraftPreviewed(process.env.WORKFLOW_ARTIFACTS_PATH ?? "./data/artifacts", workflow.issueKey, workflow.id, draft);
  return output;
}

function applyDraftForWorkflow(workflow: ReturnType<typeof find>): string {
  if (workflow.stage !== "LOCAL_TESTS" || workflow.status !== "PENDING_APPROVAL") {
    throw new Error("Draft application is available only after CODE_REVIEW has been approved and LOCAL_TESTS is waiting.");
  }
  const draft = loadDraft(workflow.issueKey, workflow.id);
  if (!wasDraftPreviewed(process.env.WORKFLOW_ARTIFACTS_PATH ?? "./data/artifacts", workflow.issueKey, workflow.id, draft)) throw new Error("Preview this exact draft before applying it.");
  if (workflow.draftFingerprint !== draftFingerprint(draft)) throw new Error("Apply requires the current staged draft to match the workflow fingerprint.");
  const root = required(process.env.PROJECT_SOURCE_ROOT, "PROJECT_SOURCE_ROOT");
  const branch = new FeatureBranchService(root).ensure(workflow.issueKey, ticketSummaryForWorkflow(workflow), process.env.PROJECT_BASE_BRANCH?.trim() || "master");
  applyDraft(root, draft);
  return `Approved test draft applied on branch ${branch}.`;
}

function ticketSummaryForWorkflow(workflow: ReturnType<typeof find>): string {
  const path = join(resolve(process.env.WORKFLOW_ARTIFACTS_PATH ?? "./data/artifacts"), workflow.issueKey, workflow.id, "issue-analysis-context.json");
  const value = JSON.parse(readFileSync(path, "utf8")) as { primaryIssue?: { fields?: { summary?: unknown } } };
  const summary = value.primaryIssue?.fields?.summary;
  if (typeof summary !== "string" || !summary.trim()) throw new Error("Issue analysis context does not contain the ticket summary required for branch naming.");
  return summary;
}
