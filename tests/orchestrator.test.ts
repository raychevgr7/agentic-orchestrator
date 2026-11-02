import { describe, expect, it } from "vitest";
import { Orchestrator } from "../src/core/orchestrator.js";
import type { Agent, Task } from "../src/core/types.js";

const task: Task = { id: "task-1", title: "Add login", objective: "Deliver secure login", constraints: [] };

describe("Orchestrator", () => {
  it("passes accumulated artifacts between agents and records a trace", async () => {
    const planner: Agent = { role: "planner", execute: async () => ({ kind: "plan", content: "Plan", createdBy: "planner" }) };
    const reviewer: Agent = {
      role: "reviewer",
      execute: async (context) => ({ kind: "review", content: String(context.artifacts.length), createdBy: "reviewer" })
    };

    const result = await new Orchestrator([planner, reviewer]).run(task, ["planner", "reviewer"]);

    expect(result.status).toBe("completed");
    expect(result.artifacts).toHaveLength(2);
    expect(result.artifacts[1]?.content).toBe("1");
    expect(result.trace).toHaveLength(4);
  });
});
