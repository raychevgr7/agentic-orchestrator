import { describe, expect, it } from "vitest";
import { validateProjectProfile } from "../src/project-profile.js";
import { assertConfiguredTestTarget } from "../src/testing/local-tests.js";

describe("project profile", () => {
  it("accepts a Java test-class profile and rejects unsafe directories", () => {
    const profile = validateProjectProfile({ version: 1, automation: { language: "java", framework: "selenium", testDirectories: ["src/test/java"], testFileExtensions: [".java"], sourceFileExtensions: [".java"], testCommandTemplate: "mvn test -Dtest={testClass}", testTargetArgument: "className" }, quality: { successfulRunsRequired: 3 } });
    expect(profile.automation.testTargetArgument).toBe("className");
    expect(() => validateProjectProfile({ ...profile, automation: { ...profile.automation, testDirectories: ["../outside"] } })).toThrow("repository-relative");
  });

  it("allows only configured test paths when executing a path target", () => {
    const profile = validateProjectProfile({ version: 1, automation: { language: "typescript", framework: "playwright", testDirectories: ["e2e"], testFileExtensions: [".spec.ts"], sourceFileExtensions: [".ts"], testCommandTemplate: "npx playwright test {test}", testTargetArgument: "path" }, quality: { successfulRunsRequired: 3 } });
    expect(() => assertConfiguredTestTarget("e2e/login.spec.ts", profile)).not.toThrow();
    expect(() => assertConfiguredTestTarget("src/login.spec.ts", profile)).toThrow("configured automation.testDirectories");
    expect(() => assertConfiguredTestTarget("e2e/login.helper.ts", profile)).toThrow("automation.testFileExtensions");
  });
});
