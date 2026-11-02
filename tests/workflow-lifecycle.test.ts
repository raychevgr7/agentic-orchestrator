import { describe, expect, it } from "vitest";
import { addFeedback, approveStage, createWorkflow, markRunning, recoverWorkflow } from "../src/workflow/lifecycle.js";

const createdAt = new Date("2026-11-02T08:00:00.000Z");

describe("workflow lifecycle", () => {
  it("starts in an approval gate and progresses one stage at a time", () => {
    const workflow = createWorkflow("demo-42", createdAt);
    const next = approveStage(workflow, "ISSUE_ANALYSIS", new Date("2026-11-02T08:01:00.000Z"));

    expect(workflow).toMatchObject({ issueKey: "DEMO-42", stage: "ISSUE_ANALYSIS", status: "PENDING_APPROVAL" });
    expect(next).toMatchObject({ stage: "TEST_PLAN", status: "PENDING_APPROVAL" });
  });

  it("requires approval at the workflow's current stage", () => {
    const workflow = createWorkflow("DEMO-42", createdAt);
    expect(() => approveStage(workflow, "TEST_PLAN")).toThrow("Workflow is waiting at ISSUE_ANALYSIS");
  });

  it("can recover an interrupted stage without advancing it", () => {
    const workflow = createWorkflow("DEMO-42", createdAt);
    const running = markRunning(workflow, "ISSUE_ANALYSIS");
    const recovered = recoverWorkflow(running);

    expect(recovered).toMatchObject({ stage: "ISSUE_ANALYSIS", status: "PENDING_APPROVAL" });
  });

  it("keeps feedback at the same stage for the next approved attempt", () => {
    const workflow = createWorkflow("DEMO-42", createdAt);
    const withFeedback = addFeedback(workflow, "Please include edge cases.");

    expect(withFeedback).toMatchObject({ stage: "ISSUE_ANALYSIS", status: "PENDING_APPROVAL", feedback: "Please include edge cases." });
  });
});
