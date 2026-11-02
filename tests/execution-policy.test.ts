import { describe, expect, it } from "vitest";
import { isAcceptedRunSequence, loadTestExecutionPolicy } from "../src/testing/execution-policy.js";

describe("test execution policy", () => {
  it("requires three consecutive passing runs by default", () => {
    const policy = loadTestExecutionPolicy({});
    expect(isAcceptedRunSequence([true, true], policy)).toBe(false);
    expect(isAcceptedRunSequence([true, false, true, true], policy)).toBe(false);
    expect(isAcceptedRunSequence([false, true, true, true], policy)).toBe(true);
  });
});
