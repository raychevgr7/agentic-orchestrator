import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectSource } from "../src/project-mcp/source.js";
import { validateProjectProfile } from "../src/project-profile.js";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("ProjectSource", () => {
  it("finds test files and ranks relevant source safely", () => {
    const root = fixtureProject();
    const project = new ProjectSource(root);

    expect(project.listTests()).toEqual(["src/auth.test.ts"]);
    expect(project.search("token")).toEqual(expect.arrayContaining([expect.objectContaining({ path: "src/auth.ts", line: 2 })]));
    expect(project.findRelevantFiles(["token"])[0]).toMatchObject({ path: "src/auth.test.ts", matchedQueries: ["token"] });
  });

  it("rejects traversal attempts when reading an excerpt", () => {
    const project = new ProjectSource(fixtureProject());
    expect(() => project.readExcerpt("../secret.ts")).toThrow("Only repository-relative");
  });

  it("rejects a repository file that is a symlink to an external source file", () => {
    const root = fixtureProject();
    const externalDirectory = mkdtempSync(join(tmpdir(), "project-mcp-external-"));
    directories.push(externalDirectory);
    const externalFile = join(externalDirectory, "secret.ts");
    writeFileSync(externalFile, "export const secret = 'do not expose';\n");
    try {
      symlinkSync(externalFile, join(root, "src", "linked.ts"), "file");
    } catch (error) {
      if (isSymlinkPermissionError(error)) return;
      throw error;
    }

    expect(() => new ProjectSource(root).readExcerpt("src/linked.ts")).toThrow("outside the configured project root");
  });

  it("does not classify production Java files as tests in a Java profile", () => {
    const root = mkdtempSync(join(tmpdir(), "project-mcp-java-")); directories.push(root);
    mkdirSync(join(root, "src", "main", "java"), { recursive: true }); mkdirSync(join(root, "src", "test", "java"), { recursive: true });
    writeFileSync(join(root, "src", "main", "java", "LoginPage.java"), "class LoginPage {}");
    writeFileSync(join(root, "src", "test", "java", "LoginTest.java"), "class LoginTest {}");
    const profile = validateProjectProfile({ version: 1, automation: { language: "java", framework: "selenium", testDirectories: ["src/test/java"], testFileExtensions: [".java"], sourceFileExtensions: [".java"], testCommandTemplate: "mvn test -Dtest={testClass}", testTargetArgument: "className" }, quality: { successfulRunsRequired: 3 } });

    expect(new ProjectSource(root, profile).listTests()).toEqual(["src/test/java/LoginTest.java"]);
  });
});

function fixtureProject(): string {
  const root = mkdtempSync(join(tmpdir(), "project-mcp-"));
  directories.push(root);
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "auth.ts"), "export function login() {}\n// token validation\n");
  writeFileSync(join(root, "src", "auth.test.ts"), "import { login } from './auth';\ntest('token login', () => login());\n");
  return root;
}

function isSymlinkPermissionError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EPERM";
}
