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

## Flaky-test gate

`TEST_SUCCESS_REPETITIONS` defines the required targeted-test repetition policy and is passed into the Engineer proposal. Runtime enforcement will be enabled with the forthcoming `LOCAL_TESTS` executor; until then, no workflow stage claims that the flaky-test gate has executed.

The first working agent is `jira-analyst`. With `jira-mcp` running and OpenAI configuration present in `.env`, run:

```bash
npm run workflow -- start PROJECT-123
npm run workflow -- analyze PROJECT-123
```

Add `--with-parent`, `--with-subtasks`, and/or `--with-related` to explicitly include those issue records in the analysis context. They are opt-in so the agent does not expand Jira access unexpectedly.

It reads only the scoped Jira issue, writes `issue-analysis.md` and its compact source context under `data/artifacts/`, then returns the workflow to `PENDING_APPROVAL`. Approve the `ISSUE_ANALYSIS` stage only after reviewing that artifact.

## Configuration

Copy `.env.example` to `.env` and add only your local integration details. `.env` is deliberately ignored by Git and no real credentials belong in this repository.

## Local project MCP server

`project-mcp` provides a safe, read-only view of a local source repository. Set `PROJECT_SOURCE_ROOT` in `.env`, then run it directly:

```bash
npm run project:mcp
```

The server exposes four MCP tools:

- `project_list_tests`
- `project_search_source`
- `project_find_relevant_files`
- `project_read_source_excerpt`

It only reads supported source files, skips common generated/dependency directories, bounds file sizes and excerpts, and rejects path-traversal attempts. Commands that modify a project or execute tests are intentionally not exposed yet.

To run the MCP servers in Docker instead, use:

```bash
docker compose up --build
```

The source project is mounted read-only and the MCP port is published only to `127.0.0.1:3002`. The optional Jira adapter uses its own Compose profile:

```bash
docker compose --profile jira up --build
```

## Jira MCP server

`jira-mcp` is an optional, read-only adapter. Configure `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, and an explicit comma-separated `JIRA_ALLOWED_PROJECT_KEYS` scope in `.env`, then run:

```bash
npm run jira:mcp
```

It listens only on `127.0.0.1` and exposes `jira_get_issue`, `jira_search_issues`, and `jira_get_attachment`. Searches are always constrained to the configured project scope; it intentionally accepts filters rather than arbitrary JQL. No Jira write operation is included.

## Status

Foundation in progress. The first migrated slice implements the generic workflow lifecycle and approval gates. MCP adapters and agent execution will follow in small, independently tested slices.

## Local development

```bash
npm install
npm run build
npm test
```
