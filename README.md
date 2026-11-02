# Agentic Orchestrator

A framework-independent TypeScript orchestrator for coordinating specialized AI agents around a single task.

The project deliberately keeps orchestration logic in application code rather than hiding it behind an agent framework. It is intended as a portfolio-quality reference implementation: explicit state transitions, role contracts, guardrails, and a traceable execution history.

## Initial architecture

```text
Task → Orchestrator → Planner → Specialist agents → Reviewer → Final response
                    ↘ shared run state and execution trace ↗
```

Each agent receives a typed context and returns a typed result. The orchestrator owns sequencing, failure policy, approval gates, and the immutable audit trail. Model providers will be introduced through a small adapter rather than coupled to agent logic.

## Status

Foundation in progress. The first vertical slice will implement a software-delivery workflow with planning, implementation, review, and release-validation roles.

## Local development

```bash
npm install
npm run build
npm test
```
