import { describe, expect, it } from "vitest";
import { addFeedback, approveStage, createWorkflow, markRunning, recoverWorkflow, returnForCodeChanges } from "../src/workflow/lifecycle.js";

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

  it("requires an APPROVE verdict bound to the current draft at code review", () => {
    const workflow = { ...createWorkflow("DEMO-42", createdAt), stage: "CODE_REVIEW" as const, reviewVerdict: "APPROVE" as const, draftFingerprint: "new-draft", reviewedDraftFingerprint: "old-draft" };
    expect(() => approveStage(workflow, "CODE_REVIEW")).toThrow("current staged draft");
    expect(approveStage({ ...workflow, reviewedDraftFingerprint: "new-draft" }, "CODE_REVIEW")).toMatchObject({ stage: "PULL_REQUEST" });
  });

  it("follows the branch, targeted-test, code-review, PR, and CI happy path", () => {
    const codeChange = { ...createWorkflow("DEMO-42", createdAt), stage: "CODE_CHANGE" as const };
    const localTests = approveStage(codeChange, "CODE_CHANGE");
    expect(() => approveStage(localTests, "LOCAL_TESTS")).toThrow("passing targeted validation");
    const codeReview = approveStage({ ...localTests, draftFingerprint: "draft-v1", validatedDraftFingerprint: "draft-v1", targetedTestFingerprint: "test-runs-v1" }, "LOCAL_TESTS");
    const reviewed = { ...codeReview, reviewVerdict: "APPROVE" as const, draftFingerprint: "draft-v1", reviewedDraftFingerprint: "draft-v1" };
    const pullRequest = approveStage(reviewed, "CODE_REVIEW");
    const ciAnalysis = approveStage(pullRequest, "PULL_REQUEST");
    const complete = approveStage(ciAnalysis, "CI_ANALYSIS");

    expect(localTests.stage).toBe("LOCAL_TESTS");
    expect(codeReview.stage).toBe("CODE_REVIEW");
    expect(pullRequest.stage).toBe("PULL_REQUEST");
    expect(ciAnalysis.stage).toBe("CI_ANALYSIS");
    expect(complete).toMatchObject({ stage: "COMPLETE", status: "COMPLETE" });
  });

  it("can recover an interrupted stage without advancing it", () => {
    const workflow = createWorkflow("DEMO-42", createdAt);
    const running = markRunning(workflow, "ISSUE_ANALYSIS");
    const recovered = recoverWorkflow(running);

    expect(recovered).toMatchObject({ stage: "ISSUE_ANALYSIS", status: "PENDING_APPROVAL" });
  });

  it("can explicitly retry a rejected stage without advancing it", () => {
    const rejected = { ...createWorkflow("DEMO-42", createdAt), stage: "LOCAL_TESTS" as const, status: "REJECTED" as const };
    expect(recoverWorkflow(rejected)).toMatchObject({ stage: "LOCAL_TESTS", status: "PENDING_APPROVAL" });
  });

  it("returns a failed code review to CODE_CHANGE with feedback", () => {
    const runningReview = { ...createWorkflow("DEMO-42", createdAt), stage: "CODE_REVIEW" as const, status: "RUNNING" as const };
    expect(returnForCodeChanges(runningReview, "Add a missing assertion.")).toMatchObject({ stage: "CODE_CHANGE", status: "PENDING_APPROVAL", feedback: "Add a missing assertion." });
  });

  it("keeps feedback at the same stage for the next approved attempt", () => {
    const workflow = createWorkflow("DEMO-42", createdAt);
    const withFeedback = addFeedback(workflow, "Please include edge cases.");

    expect(withFeedback).toMatchObject({ stage: "ISSUE_ANALYSIS", status: "PENDING_APPROVAL", feedback: "Please include edge cases." });
  });

  it("does not allow feedback to reopen a completed workflow", () => {
    const completed = { ...createWorkflow("DEMO-42", createdAt), stage: "COMPLETE" as const, status: "COMPLETE" as const };
    expect(() => addFeedback(completed, "One more change.")).toThrow("Feedback cannot be added to a completed workflow.");
  });
});
