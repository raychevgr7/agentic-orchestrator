import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rulesDirectory = join(dirname(fileURLToPath(import.meta.url)), "agent-rules");

export function loadOrchestratorRule(): string {
  return readFileSync(join(rulesDirectory, "orchestrator.md"), "utf8").trim();
}
