import { describe, expect, it } from "vitest";
import { FeatureBranchService } from "../src/code-changes/git-branch.js";

describe("FeatureBranchService", () => {
  it("creates an issue-scoped automation branch from master", () => {
    const calls: string[][] = [];
    const run = (args: string[]) => { calls.push(args); if (args[0] === "status") return ""; if (args.join(" ") === "branch --show-current") return "master\n"; if (args[0] === "branch") return ""; return ""; };
    expect(new FeatureBranchService("unused", run).ensure("DEMO-42", "Login validation error")).toBe("DEMO-42/login-validation-error");
    expect(calls).toEqual([["branch", "--show-current"], ["status", "--porcelain"], ["branch", "--list", "DEMO-42/login-validation-error"], ["switch", "master"], ["switch", "-c", "DEMO-42/login-validation-error"]]);
  });
});
