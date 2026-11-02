export interface TestExecutionPolicy {
  requiredConsecutiveSuccesses: number;
}

export function loadTestExecutionPolicy(environment = process.env): TestExecutionPolicy {
  const value = Number.parseInt(environment.TEST_SUCCESS_REPETITIONS ?? "3", 10);
  if (!Number.isInteger(value) || value < 1 || value > 10) {
    throw new Error("TEST_SUCCESS_REPETITIONS must be an integer between 1 and 10.");
  }
  return { requiredConsecutiveSuccesses: value };
}

export function isAcceptedRunSequence(results: readonly boolean[], policy: TestExecutionPolicy): boolean {
  if (results.length < policy.requiredConsecutiveSuccesses) return false;
  return results.slice(-policy.requiredConsecutiveSuccesses).every(Boolean);
}
