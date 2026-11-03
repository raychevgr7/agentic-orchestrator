import { existsSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import type { ProjectProfile } from "../project-profile.js";

const allowedTestFile = /(?:^|\/)(?:test|tests|spec|__tests__)(?:\/|$)|\.(?:test|spec)\.(?:ts|tsx|js|jsx|java|py)$/i;
const allowedExtension = /\.(?:ts|tsx|js|jsx|java|py)$/i;

export class ApprovedTestWriter {
  private readonly root: string;
  private readonly profile?: ProjectProfile;
  public constructor(root: string, profile?: ProjectProfile) { this.root = realpathSync(root); this.profile = profile; }

  public write(path: string, content: string): void {
    const target = this.target(path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, "utf8");
  }

  public target(path: string): string {
    const normalized = path.replace(/\\/g, "/");
    const matchesProfile = this.profile && this.profile.automation.testDirectories.some(directory => normalized.startsWith(`${directory}/`)) && this.profile.automation.testFileExtensions.some(extension => normalized.toLowerCase().endsWith(extension));
    if (!(matchesProfile ?? (allowedTestFile.test(normalized) && allowedExtension.test(normalized))) || normalized.split("/").includes("..")) {
      throw new Error("Only repository-relative test files with supported extensions may be written.");
    }
    const target = resolve(this.root, normalized);
    if (!target.startsWith(this.root + sep)) throw new Error("Write target is outside the configured project root.");
    assertNoSymlinkParent(this.root, normalized);
    if (existsSync(target) && lstatSync(target).isSymbolicLink()) throw new Error("Refusing to write through a symbolic link.");
    return target;
  }
}

function assertNoSymlinkParent(root: string, normalizedPath: string): void {
  const parentSegments = normalizedPath.split("/").slice(0, -1);
  let current = root;
  for (const segment of parentSegments) {
    current = resolve(current, segment);
    if (!existsSync(current)) return;
    if (lstatSync(current).isSymbolicLink()) throw new Error("Refusing to write through a symbolic-link directory.");
  }
}
