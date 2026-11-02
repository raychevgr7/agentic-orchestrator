import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ApprovedTestWriter } from "../src/project-mcp/writer.js";
const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
describe("ApprovedTestWriter", () => {
  it("writes only supported repository-relative test files", () => {
    const root = mkdtempSync(join(tmpdir(), "approved-test-writer-")); directories.push(root); mkdirSync(join(root, "tests"));
    const writer = new ApprovedTestWriter(root); writer.write("tests/login.spec.ts", "test('login', () => {});\n");
    expect(readFileSync(join(root, "tests", "login.spec.ts"), "utf8")).toContain("login");
    expect(() => writer.write(".env", "secret")).toThrow("Only repository-relative test files");
    expect(() => writer.write("../outside.spec.ts", "x")).toThrow("Only repository-relative test files");
  });

  it("rejects a symlinked parent directory", () => {
    const root = mkdtempSync(join(tmpdir(), "approved-test-writer-")); const external = mkdtempSync(join(tmpdir(), "approved-test-external-")); directories.push(root, external);
    try { symlinkSync(external, join(root, "tests"), "junction"); } catch (error) { if (isPermissionError(error)) return; throw error; }
    expect(() => new ApprovedTestWriter(root).write("tests/login.spec.ts", "x")).toThrow("symbolic-link directory");
  });
});

function isPermissionError(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && error.code === "EPERM"; }
