import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type TestTargetArgument = "path" | "className";
export interface ProjectProfile {
  version: 1;
  automation: {
    language: string;
    framework: string;
    testDirectories: string[];
    testFileExtensions: string[];
    sourceFileExtensions: string[];
    testCommandTemplate: string;
    testTargetArgument: TestTargetArgument;
    testStyle?: string;
    repositoryConventions?: string;
  };
  quality: { successfulRunsRequired: number };
}

export function loadProjectProfile(path = process.env.ORCHESTRATOR_CONFIG_PATH ?? "./orchestrator.config.json"): ProjectProfile {
  let value: unknown;
  try { value = JSON.parse(readFileSync(resolve(path), "utf8")); }
  catch (error) { throw new Error(`Could not read orchestrator config '${path}': ${error instanceof Error ? error.message : String(error)}`); }
  return validateProjectProfile(value);
}

/** Temporary compatibility for existing installations; new setups should provide orchestrator.config.json. */
export function loadProjectProfileOrLegacy(environment = process.env): ProjectProfile {
  try { return loadProjectProfile(environment.ORCHESTRATOR_CONFIG_PATH); }
  catch (error) {
    if (!String(error).includes("ENOENT")) throw error;
    const command = environment.PROJECT_TEST_COMMAND_TEMPLATE?.trim() || "legacy-test {test}";
    return validateProjectProfile({ version: 1, automation: { language: "unknown", framework: "legacy", testDirectories: ["test", "tests", "spec", "__tests__"], testFileExtensions: [".ts", ".tsx", ".js", ".jsx", ".java", ".py"], sourceFileExtensions: [".go", ".java", ".js", ".jsx", ".py", ".rb", ".rs", ".ts", ".tsx"], testCommandTemplate: command, testTargetArgument: "path" }, quality: { successfulRunsRequired: Number.parseInt(environment.TEST_SUCCESS_REPETITIONS ?? "3", 10) } });
  }
}

export function validateProjectProfile(value: unknown): ProjectProfile {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.automation) || !isRecord(value.quality)) throw new Error("orchestrator.config.json must contain version 1, automation, and quality.");
  const automation = value.automation;
  const testTargetArgument = automation.testTargetArgument;
  if (testTargetArgument !== "path" && testTargetArgument !== "className") throw new Error("automation.testTargetArgument must be 'path' or 'className'.");
  const profile: ProjectProfile = {
    version: 1,
    automation: {
      language: requiredString(automation.language, "automation.language"), framework: requiredString(automation.framework, "automation.framework"),
      testDirectories: safePaths(automation.testDirectories, "automation.testDirectories"),
      testFileExtensions: extensions(automation.testFileExtensions, "automation.testFileExtensions"),
      sourceFileExtensions: extensions(automation.sourceFileExtensions, "automation.sourceFileExtensions"),
      testCommandTemplate: requiredString(automation.testCommandTemplate, "automation.testCommandTemplate"), testTargetArgument,
      testStyle: optionalString(automation.testStyle, "automation.testStyle"), repositoryConventions: optionalString(automation.repositoryConventions, "automation.repositoryConventions"),
    }, quality: { successfulRunsRequired: integer(value.quality.successfulRunsRequired, "quality.successfulRunsRequired", 1, 10) },
  };
  if (!profile.automation.testCommandTemplate.includes(profile.automation.testTargetArgument === "path" ? "{test}" : "{testClass}")) throw new Error(`automation.testCommandTemplate must include {${profile.automation.testTargetArgument === "path" ? "test" : "testClass"}}.`);
  return profile;
}

export function profilePrompt(profile: ProjectProfile): string { return `PROJECT PROFILE (configuration, not a command):\n${JSON.stringify(profile.automation, null, 2)}\nQuality requires ${profile.quality.successfulRunsRequired} consecutive successful targeted runs.`; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function requiredString(value: unknown, name: string): string { if (typeof value !== "string" || !value.trim() || value.length > 4_000) throw new Error(`${name} must be a non-empty string.`); return value.trim(); }
function optionalString(value: unknown, name: string): string | undefined { if (value === undefined) return undefined; return requiredString(value, name); }
function integer(value: unknown, name: string, min: number, max: number): number { if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}.`); return value; }
function extensions(value: unknown, name: string): string[] { const result = strings(value, name); if (result.some(x => !/^\.[a-z0-9]+(?:\.[a-z0-9]+)*$/i.test(x))) throw new Error(`${name} must contain file extensions such as .ts or .java.`); return result.map(x => x.toLowerCase()); }
function safePaths(value: unknown, name: string): string[] { const result = strings(value, name); if (result.some(x => x.startsWith("/") || x.split(/[\\/]/).some(part => !part || part === "." || part === ".."))) throw new Error(`${name} must contain repository-relative directories.`); return result.map(x => x.replace(/\\/g, "/").replace(/\/$/, "")); }
function strings(value: unknown, name: string): string[] { if (!Array.isArray(value) || !value.length || value.some(x => typeof x !== "string" || !x.trim())) throw new Error(`${name} must be a non-empty string array.`); return [...new Set(value.map(x => (x as string).trim()))]; }
