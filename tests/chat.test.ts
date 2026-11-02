import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChatService, type ActionInterpreter, type ChatAction, type WorkflowActivities } from "../src/chat.js";
import { SqliteWorkflowStore } from "../src/workflow/store.js";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("ChatService", () => {
  it("proposes an action and executes it only after confirmation", async () => {
    const { chat, store } = createChat({ kind: "START_WORKFLOW", issueKey: "DEMO-7", explanation: "I can start the workflow." });

    await expect(chat.respond("Start work for DEMO-7")).resolves.toContain("Planned action: START_WORKFLOW for DEMO-7");
    expect(store.find("DEMO-7")).toBeUndefined();
    await expect(chat.respond("yes")).resolves.toContain("Workflow started");
    expect(store.find("DEMO-7")).toMatchObject({ stage: "ISSUE_ANALYSIS", status: "PENDING_APPROVAL" });
    store.close();
  });

  it("cancels a pending action without changing the workflow", async () => {
    const { chat, store } = createChat({ kind: "START_WORKFLOW", issueKey: "DEMO-8", explanation: "I can start the workflow." });

    await chat.respond("Start work for DEMO-8");
    await expect(chat.respond("cancel")).resolves.toContain("cancelled");
    expect(store.find("DEMO-8")).toBeUndefined();
    store.close();
  });

  it("keeps a pending action when execution fails, so it can be retried", async () => {
    const { chat, store } = createChat({ kind: "APPROVE_STAGE", issueKey: "DEMO-9", stage: "TEST_PLAN", explanation: "I can approve the workflow." });
    store.create({ id: "DEMO-9-existing", issueKey: "DEMO-9", stage: "ISSUE_ANALYSIS", status: "PENDING_APPROVAL", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });

    await chat.respond("Approve TEST_PLAN for DEMO-9");
    await expect(chat.respond("yes")).rejects.toThrow();
    expect(store.getPendingAction()).toMatchObject({ kind: "APPROVE_STAGE", issueKey: "DEMO-9" });
    store.close();
  });

  it("runs issue analysis only after confirmation", async () => {
    const { chat, store } = createChat({ kind: "ANALYZE_ISSUE", issueKey: "DEMO-10", explanation: "I can analyze the issue." }, {
      analyzeIssue: async (issueKey: string) => `Analysis complete for ${issueKey}.`,
    });

    await chat.respond("Analyze DEMO-10");
    await expect(chat.respond("yes")).resolves.toBe("Analysis complete for DEMO-10.");
    expect(store.getPendingAction()).toBeUndefined();
    store.close();
  });

  it("runs automation discovery only after confirmation", async () => {
    const { chat, store } = createChat({ kind: "DISCOVER_AUTOMATION", issueKey: "DEMO-11", explanation: "I can inspect automation." }, {
      discoverAutomation: async (issueKey: string) => `Discovery complete for ${issueKey}.`,
    });
    await chat.respond("Discover automation for DEMO-11");
    await expect(chat.respond("yes")).resolves.toBe("Discovery complete for DEMO-11.");
    store.close();
  });

  it("runs code review only after confirmation", async () => {
    const { chat, store } = createChat({ kind: "REVIEW_CODE", issueKey: "DEMO-12", explanation: "I can review the staged code." }, {
      reviewCode: async (issueKey: string) => `Code review complete for ${issueKey}.`,
    });
    await chat.respond("Review the code for DEMO-12");
    await expect(chat.respond("yes")).resolves.toBe("Code review complete for DEMO-12.");
    expect(store.getPendingAction()).toBeUndefined();
    store.close();
  });

  it("generates a draft only after confirmation", async () => {
    const { chat, store } = createChat({ kind: "GENERATE_DRAFT", issueKey: "DEMO-13", explanation: "I can generate a test draft." }, {
      generateDraft: async (issueKey: string) => `Draft generated for ${issueKey}.`,
    });
    await chat.respond("Generate a test draft for DEMO-13");
    await expect(chat.respond("yes")).resolves.toBe("Draft generated for DEMO-13.");
    expect(store.getPendingAction()).toBeUndefined();
    store.close();
  });

  it("previews and applies a draft only after separate confirmations", async () => {
    const { chat, store } = createChat({ kind: "PREVIEW_DRAFT", issueKey: "DEMO-14", explanation: "I can preview the draft." }, {
      previewDraft: async () => "Draft preview.",
      applyDraft: async () => "Draft applied.",
    });
    await chat.respond("Preview draft for DEMO-14");
    await expect(chat.respond("yes")).resolves.toBe("Draft preview.");

    const applyInterpreter: ActionInterpreter = { interpret: async () => ({ kind: "APPLY_DRAFT", issueKey: "DEMO-14", explanation: "I can apply the approved draft." }) };
    const applyChat = new ChatService(store, applyInterpreter, { applyDraft: async () => "Draft applied." });
    await applyChat.respond("Apply draft for DEMO-14");
    await expect(applyChat.respond("yes")).resolves.toBe("Draft applied.");
    store.close();
  });

  it("runs an explicitly supplied targeted test only after confirmation", async () => {
    const { chat, store } = createChat({ kind: "VERIFY_TESTS", issueKey: "DEMO-15", testTarget: "tests/login.spec.ts", explanation: "I can run the targeted test." }, {
      verifyTests: async (issueKey, target) => `Validated ${target} for ${issueKey}.`,
    });
    await expect(chat.respond("Run tests/login.spec.ts for DEMO-15")).resolves.toContain("VERIFY_TESTS for DEMO-15 (tests/login.spec.ts)");
    await expect(chat.respond("yes")).resolves.toBe("Validated tests/login.spec.ts for DEMO-15.");
    store.close();
  });

  it("prepares a pull request description only after confirmation", async () => {
    const { chat, store } = createChat({ kind: "PREPARE_PULL_REQUEST", issueKey: "DEMO-16", explanation: "I can prepare a PR description." }, {
      preparePullRequest: async issueKey => `PR description prepared for ${issueKey}.`,
    });
    await chat.respond("Prepare a pull request for DEMO-16");
    await expect(chat.respond("yes")).resolves.toBe("PR description prepared for DEMO-16.");
    store.close();
  });

  it("analyzes an explicitly supplied CI build only after confirmation", async () => {
    const { chat, store } = createChat({ kind: "ANALYZE_CI", issueKey: "DEMO-17", ciBuildNumber: "42", explanation: "I can analyze the CI build." }, {
      analyzeCi: async (issueKey, buildNumber) => `CI #${buildNumber} analyzed for ${issueKey}.`,
    });
    await expect(chat.respond("Analyze CI build 42 for DEMO-17")).resolves.toContain("ANALYZE_CI for DEMO-17 (#42)");
    await expect(chat.respond("yes")).resolves.toBe("CI #42 analyzed for DEMO-17.");
    store.close();
  });
});

function createChat(action: ChatAction, activities?: WorkflowActivities) {
  const directory = mkdtempSync(join(tmpdir(), "agentic-orchestrator-chat-"));
  directories.push(directory);
  const store = new SqliteWorkflowStore(join(directory, "workflows.db"));
  const interpreter: ActionInterpreter = { interpret: async () => action };
  return { chat: new ChatService(store, interpreter, activities), store };
}
