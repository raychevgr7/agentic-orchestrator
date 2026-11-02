import type { Agent, AgentContext, AgentRole, Artifact, RunState, Task, TraceEvent } from "./types.js";

export class Orchestrator {
  private readonly agents = new Map<AgentRole, Agent>();

  public constructor(agents: readonly Agent[]) {
    for (const agent of agents) {
      if (this.agents.has(agent.role)) {
        throw new Error(`Duplicate agent role: ${agent.role}`);
      }
      this.agents.set(agent.role, agent);
    }
  }

  public async run(task: Task, workflow: readonly AgentRole[]): Promise<RunState> {
    const state: RunState = { task, status: "running", artifacts: [], trace: [] };

    for (const role of workflow) {
      const agent = this.agents.get(role);
      if (!agent) {
        state.status = "failed";
        state.trace.push(this.event(role, "failed", "No agent is registered for this role."));
        return state;
      }

      state.trace.push(this.event(role, "started", "Agent execution started."));
      try {
        const artifact = await agent.execute(this.contextFrom(state));
        state.artifacts.push(artifact);
        state.trace.push(this.event(role, "completed", `Produced ${artifact.kind}.`));
      } catch (error) {
        state.status = "failed";
        const message = error instanceof Error ? error.message : "Unknown agent error";
        state.trace.push(this.event(role, "failed", message));
        return state;
      }
    }

    state.status = "completed";
    return state;
  }

  private contextFrom(state: RunState): AgentContext {
    return { task: state.task, artifacts: state.artifacts };
  }

  private event(agent: AgentRole, event: TraceEvent["event"], summary: string): TraceEvent {
    return { timestamp: new Date().toISOString(), agent, event, summary };
  }
}
