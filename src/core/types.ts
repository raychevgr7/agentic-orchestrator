export type AgentRole = "planner" | "implementer" | "reviewer" | "validator";

export type RunStatus = "pending" | "running" | "awaiting_approval" | "completed" | "failed";

export interface Task {
  id: string;
  title: string;
  objective: string;
  constraints: string[];
}

export interface Artifact {
  kind: string;
  content: string;
  createdBy: AgentRole;
}

export interface TraceEvent {
  timestamp: string;
  agent: AgentRole;
  event: "started" | "completed" | "failed" | "skipped";
  summary: string;
}

export interface RunState {
  task: Task;
  status: RunStatus;
  artifacts: Artifact[];
  trace: TraceEvent[];
}

export interface AgentContext {
  task: Task;
  artifacts: readonly Artifact[];
}

export interface Agent {
  readonly role: AgentRole;
  execute(context: AgentContext): Promise<Artifact>;
}
