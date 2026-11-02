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
    await expect(chat.respond("да")).resolves.toContain("Workflow started");
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
});

function createChat(action: ChatAction, activities?: WorkflowActivities) {
  const directory = mkdtempSync(join(tmpdir(), "agentic-orchestrator-chat-"));
  directories.push(directory);
  const store = new SqliteWorkflowStore(join(directory, "workflows.db"));
  const interpreter: ActionInterpreter = { interpret: async () => action };
  return { chat: new ChatService(store, interpreter, activities), store };
}
