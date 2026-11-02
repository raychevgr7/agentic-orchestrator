import { spawnSync } from "node:child_process";

export class FeatureBranchService {
  public constructor(private readonly projectRoot: string, private readonly run: (args: string[]) => string = args => git(projectRoot, args)) {}
  public ensure(issueKey: string, ticketSummary: string, baseBranch = "master"): string {
    const slug = ticketSummary.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
    if (!slug) throw new Error("Ticket summary cannot produce a feature branch name.");
    const branch = `${issueKey.toUpperCase()}/${slug}`;
    if (!/^[A-Z][A-Z0-9]+-\d+\/[a-z0-9-]+$/.test(branch)) throw new Error("Invalid issue key for feature branch.");
    if (this.run(["status", "--porcelain"]).trim()) throw new Error("Project working tree must be clean before creating a feature branch.");
    const current = this.run(["branch", "--show-current"]).trim();
    if (current === branch) return branch;
    const branches = this.run(["branch", "--list", branch]).trim();
    if (branches) { this.run(["switch", branch]); return branch; }
    this.run(["switch", baseBranch]); this.run(["switch", "-c", branch]); return branch;
  }
}

function git(projectRoot: string, args: string[]): string { const result = spawnSync("git", args, { cwd: projectRoot, encoding: "utf8" }); if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed.`); return result.stdout; }
