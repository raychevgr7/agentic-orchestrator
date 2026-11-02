# Agentic Orchestrator

A framework-independent TypeScript orchestrator for coordinating specialized AI agents around a single task.

The project deliberately keeps orchestration logic in application code rather than hiding it behind an agent framework. It is intended as a portfolio-quality reference implementation: explicit state transitions, role contracts, guardrails, and a traceable execution history.

## Initial architecture

```text
Issue → Orchestrator → Specialist agents → Approval gates → Final outcome
                     ↘ persistent workflow state and audit trail ↗
```

Each agent receives a typed context and returns a typed result. The orchestrator owns sequencing, failure policy, approval gates, and the immutable audit trail. Model providers will be introduced through a small adapter rather than coupled to agent logic.

## Workflow lifecycle

The initial workflow deliberately pauses after every stage. A person must approve the current stage before the next one becomes available. This makes external-system access and eventual write operations explicit and auditable.

```text
ISSUE_ANALYSIS → TEST_PLAN → PROJECT_DISCOVERY → CODE_CHANGE → LOCAL_TESTS
→ PULL_REQUEST → CI_ANALYSIS → ISSUE_COMMENT → COMPLETE
```

The included stages are generic: integrations such as Jira, Jenkins, GitHub/GitLab, and a local project are optional adapters configured by the person running the project.

## Configuration

Copy `.env.example` to `.env` and add only your local integration details. `.env` is deliberately ignored by Git and no real credentials belong in this repository.

## Status

Foundation in progress. The first migrated slice implements the generic workflow lifecycle and approval gates. MCP adapters and agent execution will follow in small, independently tested slices.

## Local development

```bash
npm install
npm run build
npm test
```
