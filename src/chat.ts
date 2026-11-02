import OpenAI from "openai";
import { loadOrchestratorRule } from "./agent-rules.js";
import { addFeedback, approveStage, createWorkflow } from "./workflow/lifecycle.js";
import type { PendingAction, WorkflowStore } from "./workflow/store.js";
import { workflowStages, type WorkflowStage } from "./workflow/types.js";
import { isRepositoryRelativeTestTarget } from "./testing/local-tests.js";

export const actionKinds = [
  "START_WORKFLOW",
  "ANALYZE_ISSUE",
  "DESIGN_TESTS",
  "DISCOVER_AUTOMATION",
  "GENERATE_DRAFT",
  "PREVIEW_DRAFT",
  "APPLY_DRAFT",
  "REVIEW_CODE",
  "VERIFY_TESTS",
  "SHOW_STATUS",
  "APPROVE_STAGE",
  "ADD_FEEDBACK",
  "UNKNOWN",
] as const;

export type ChatActionKind = (typeof actionKinds)[number];

export interface ChatAction extends PendingAction {
  kind: ChatActionKind;
  stage?: WorkflowStage;
}

export interface ActionInterpreter {
  interpret(message: string): Promise<ChatAction>;
}

export interface WorkflowActivities {
  analyzeIssue?: (issueKey: string) => Promise<string>;
  designTests?: (issueKey: string) => Promise<string>;
  discoverAutomation?: (issueKey: string) => Promise<string>;
  generateDraft?: (issueKey: string) => Promise<string>;
  previewDraft?: (issueKey: string) => Promise<string>;
  applyDraft?: (issueKey: string) => Promise<string>;
  reviewCode?: (issueKey: string) => Promise<string>;
  verifyTests?: (issueKey: string, testTarget: string) => Promise<string>;
}

export class OpenAIActionInterpreter implements ActionInterpreter {
  public async interpret(message: string): Promise<ChatAction> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new Error("OPENAI_API_KEY is missing. Add it only to your local .env file.");

    const response = await new OpenAI({ apiKey }).responses.create({
      model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
      max_output_tokens: 400,
      store: false,
      input: [
        { role: "developer", content: loadOrchestratorRule()
          .replace("{{ACTIONS}}", actionKinds.join(", "))
          .replace("{{STAGES}}", workflowStages.join(", ")) },
        { role: "user", content: message },
      ],
    });
    if (response.status !== "completed" || !response.output_text.trim()) {
      throw new Error(`Action interpretation did not complete successfully (status: ${response.status}).`);
    }
    return validateAction(JSON.parse(response.output_text));
  }
}

export class ChatService {
  public constructor(private readonly store: WorkflowStore, private readonly interpreter: ActionInterpreter, private readonly activities?: WorkflowActivities) {}

  public async respond(message: string): Promise<string> {
    const trimmed = message.trim();
    if (!trimmed) throw new Error("Write a message after chat.");
    if (isConfirmation(trimmed)) return this.executePending();
    if (isCancellation(trimmed)) {
      this.store.clearPendingAction();
      return "Pending action cancelled. No workflow action was performed.";
    }

    const action = await this.interpreter.interpret(trimmed);
    if (action.kind === "UNKNOWN") return `I need more detail: ${action.explanation}`;
    if (!action.issueKey) return `An issue key is required, for example PROJECT-123. ${action.explanation}`;
    this.store.savePendingAction(action);
    return `${action.explanation}\n\nPlanned action: ${describe(action)}\n\nReply with \"yes\" to confirm or \"cancel\" to cancel.`;
  }

  private async executePending(): Promise<string> {
    const action = this.store.getPendingAction() as ChatAction | undefined;
    if (!action) return "No pending action. Describe what you would like to do.";
    const result = await this.execute(action);
    this.store.clearPendingAction();
    return result;
  }

  private async execute(action: ChatAction): Promise<string> {
    const issueKey = action.issueKey!;

    switch (action.kind) {
      case "START_WORKFLOW": {
        const workflow = createWorkflow(issueKey);
        this.store.create(workflow);
        return `Workflow started:\n${JSON.stringify(workflow, null, 2)}`;
      }
      case "SHOW_STATUS":
        return JSON.stringify(requiredWorkflow(this.store, issueKey), null, 2);
      case "APPROVE_STAGE": {
        if (!action.stage) throw new Error("The requested approval did not include a workflow stage.");
        const updated = approveStage(requiredWorkflow(this.store, issueKey), action.stage);
        this.store.save(updated);
        return `Workflow approved:\n${JSON.stringify(updated, null, 2)}`;
      }
      case "ADD_FEEDBACK": {
        if (!action.feedback) throw new Error("The requested feedback is empty.");
        const updated = addFeedback(requiredWorkflow(this.store, issueKey), action.feedback);
        this.store.save(updated);
        return `Feedback saved:\n${JSON.stringify(updated, null, 2)}`;
      }
      case "ANALYZE_ISSUE": {
        if (!this.activities?.analyzeIssue) throw new Error("No issue analysis executor is registered.");
        return this.activities.analyzeIssue(issueKey);
      }
      case "DESIGN_TESTS":
        if (!this.activities?.designTests) throw new Error("No test design executor is registered.");
        return this.activities.designTests(issueKey);
      case "DISCOVER_AUTOMATION":
        if (!this.activities?.discoverAutomation) throw new Error("No automation discovery executor is registered.");
        return this.activities.discoverAutomation(issueKey);
      case "GENERATE_DRAFT":
        if (!this.activities?.generateDraft) throw new Error("No draft generation executor is registered.");
        return this.activities.generateDraft(issueKey);
      case "PREVIEW_DRAFT":
        if (!this.activities?.previewDraft) throw new Error("No draft preview executor is registered.");
        return this.activities.previewDraft(issueKey);
      case "APPLY_DRAFT":
        if (!this.activities?.applyDraft) throw new Error("No draft application executor is registered.");
        return this.activities.applyDraft(issueKey);
      case "REVIEW_CODE":
        if (!this.activities?.reviewCode) throw new Error("No code review executor is registered.");
        return this.activities.reviewCode(issueKey);
      case "VERIFY_TESTS":
        if (!action.testTarget) throw new Error("The requested test run did not include a test target.");
        if (!isRepositoryRelativeTestTarget(action.testTarget)) throw new Error("The requested test target is not repository-relative and safe.");
        if (!this.activities?.verifyTests) throw new Error("No local test executor is registered.");
        return this.activities.verifyTests(issueKey, action.testTarget);
      default:
        return "That request cannot be executed through chat yet.";
    }
  }
}

function requiredWorkflow(store: WorkflowStore, issueKey: string) {
  const workflow = store.find(issueKey);
  if (!workflow) throw new Error(`Workflow '${issueKey}' was not found.`);
  return workflow;
}

function validateAction(value: unknown): ChatAction {
  if (!isRecord(value) || !actionKinds.includes(value.kind as ChatActionKind)) throw new Error("Chat interpretation returned an unsupported action.");
  const issueKey = typeof value.issueKey === "string" ? value.issueKey.toUpperCase() : undefined;
  if (issueKey && !/^[A-Z][A-Z0-9]+-\d+$/.test(issueKey)) throw new Error("Chat interpretation returned an invalid issue key.");
  const stage = typeof value.stage === "string" ? value.stage as WorkflowStage : undefined;
  if (stage && !workflowStages.includes(stage)) throw new Error("Chat interpretation returned an unsupported workflow stage.");
  const testTarget = typeof value.testTarget === "string" ? value.testTarget : undefined;
  if (testTarget && !isRepositoryRelativeTestTarget(testTarget)) throw new Error("Chat interpretation returned an unsafe test target.");
  return { kind: value.kind as ChatActionKind, issueKey, stage, feedback: typeof value.feedback === "string" ? value.feedback : undefined, testTarget, explanation: String(value.explanation ?? "") };
}

function describe(action: ChatAction): string {
  return `${action.kind}${action.issueKey ? ` for ${action.issueKey}` : ""}${action.stage ? ` at ${action.stage}` : ""}${action.testTarget ? ` (${action.testTarget})` : ""}`;
}

function isConfirmation(message: string): boolean { return /^(yes|confirm|ok)$/i.test(message); }
function isCancellation(message: string): boolean { return /^(no|cancel|stop)$/i.test(message); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
