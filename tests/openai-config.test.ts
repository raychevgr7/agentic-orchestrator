import { afterEach, describe, expect, it } from "vitest";
import { boundedTokenBudget, openAIModel, openAIReasoningEffort } from "../src/core/openai-config.js";

const originalModel = process.env.OPENAI_MODEL;
const originalBudget = process.env.TEST_BUDGET;

afterEach(() => {
  if (originalModel === undefined) delete process.env.OPENAI_MODEL;
  else process.env.OPENAI_MODEL = originalModel;
  if (originalBudget === undefined) delete process.env.TEST_BUDGET;
  else process.env.TEST_BUDGET = originalBudget;
});

describe("OpenAI configuration", () => {
  it("defaults to the local POC model and low reasoning", () => {
    delete process.env.OPENAI_MODEL;
    expect(openAIModel()).toBe("gpt-6-luna");
    expect(openAIReasoningEffort()).toBe("low");
  });

  it("accepts only token budgets inside their configured bounds", () => {
    process.env.TEST_BUDGET = "1200";
    expect(boundedTokenBudget("TEST_BUDGET", 1000, 500, 3000)).toBe(1200);
    process.env.TEST_BUDGET = "999999";
    expect(boundedTokenBudget("TEST_BUDGET", 1000, 500, 3000)).toBe(1000);
    process.env.TEST_BUDGET = "1200abc";
    expect(boundedTokenBudget("TEST_BUDGET", 1000, 500, 3000)).toBe(1000);
  });
});
