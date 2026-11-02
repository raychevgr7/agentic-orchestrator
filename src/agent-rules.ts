import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rulesDirectory = join(dirname(fileURLToPath(import.meta.url)), "agent-rules");

export function loadOrchestratorRule(): string {
  return readFileSync(join(rulesDirectory, "orchestrator.md"), "utf8").trim();
}

export function loadJiraAnalystRule(): string {
  return readFileSync(join(rulesDirectory, "jira-analyst.md"), "utf8").trim();
}

export function loadTestDesignerRule(): string {
  return readFileSync(join(rulesDirectory, "test-designer.md"), "utf8").trim();
}
