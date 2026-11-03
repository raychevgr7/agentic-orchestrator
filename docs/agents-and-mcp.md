# Agents, MCP Servers, and Operating Rules

This document describes the public contracts of the orchestrator. All agent output is English-only. Agents operate on supplied artifacts only; they must not invent repository facts, credentials, execution results, or external actions.

## Shared operating model

The workflow owns state transitions and human approval. An agent may create an artifact, but cannot advance a stage by itself. Chat interprets one request into one proposed action and requires a separate `yes` confirmation before execution.

Write operations are deliberately narrow:

- `apply-draft` writes only a supported test file under `PROJECT_SOURCE_ROOT`.
- A local feature branch is created from `PROJECT_BASE_BRANCH` (`master` by default) before the draft is applied.
- The targeted test must use the exact path from the current staged draft and pass three consecutive runs before review. Its evidence is bound to that draft, so `LOCAL_TESTS` cannot advance with a stale, missing, or unrelated result.
- Commit, push, and opening a pull request remain manual.

This reference implementation targets TypeScript and Playwright. Test writes and targeted validation are limited to `.spec.ts` or `.test.ts` files beneath `tests/`; validation runs `npx playwright test <target>` three consecutive times. Credentials and integration endpoints remain in `.env`.

## Agent rules

| Agent | Inputs | Output artifact | Key rules |
| --- | --- | --- | --- |
| Orchestrator | User message | Proposed action | English-only JSON intent; never executes or invents values. |
| Jira Analyst | Scoped Jira issue and explicitly requested related records | `issue-analysis.md` | Facts versus hypotheses; no Jira writes; unknowns are explicit. |
| Test Designer | Issue analysis | `test-plan.md` | Functional plan only; at most 10 traceable scenarios; no repository assumptions. |
| Automation Designer | Approved test plan and read-only source discovery | `automation-decision.md` | Selects feasible automation scope; no code changes or invented paths/locators. |
| Engineer Planner | Automation decision and discovery context | `implementation-proposal.md` | Proposes target files and validation; does not write code or run tests. |
| Engineer Draft Generator | Approved implementation proposal | `staged-test-draft.json` | Returns JSON only; repository-relative supported test path and complete file content. |
| Code Reviewer | Applied draft, actual Git diff, test evidence, plan and decision | `code-review.md` | `APPROVE`, `REQUEST_CHANGES`, or `BLOCKED`; approves only in-scope, review-ready code. |
| PR Preparation | Ticket, scope, implementation, review and validation artifacts | `pull-request-description.md` | Draft description only; states missing evidence; does not commit, push, or open a PR. |
| CI Analyst | Sanitized CI build report | `ci-analysis.md` | Read-only analysis; distinguishes facts and hypotheses; never claims a non-success build passed. |

### Artifact ordering and evidence

PR preparation prioritises targeted-test result, code review, and implementation before broader ticket context. Each artifact is bounded and the whole context is capped, so large Jira data cannot remove validation evidence from model input.

Code review occurs after the test is written on the feature branch and after targeted validation. It receives a bounded actual Git diff as well as the persisted workflow artifacts.

## MCP and CI boundaries

### `project-mcp`

Read-only local source adapter. Tools are `project_list_tests`, `project_search_source`, `project_find_relevant_files`, and `project_read_source_excerpt`.

- Loopback binding by default; Docker publishes only on loopback.
- Traversal, symlink escapes, unsupported files, generated directories, and oversized excerpts are rejected or bounded.
- It has no write or command-execution tool.

### `jira-mcp`

Read-only Jira adapter. Tools are `jira_get_issue`, `jira_search_issues`, and `jira_get_attachment`.

- The required `JIRA_ALLOWED_PROJECT_KEYS` allowlist scopes issue reads and searches.
- Arbitrary JQL and Jira writes are not exposed.
- Attachment reads are bounded and must belong to the requested scoped issue.

### `jenkins-mcp`

Read-only Jenkins MCP adapter. Tools are `jenkins_get_build`, `jenkins_get_console_excerpt`, and `jenkins_get_test_report`. `jenkins_get_build` returns metadata and JUnit totals only; bounded, sanitized console output is available solely through `jenkins_get_console_excerpt`.

- Every tool requires a `jobPath` and positive `buildNumber`. `jobPath` must exactly match one of the locally configured `JENKINS_ALLOWED_JOB_PATHS` entries; arbitrary Jenkins job paths are rejected before any Jenkins request.
- Retrieves build metadata, JUnit report when available, and console output.
- Uses Jenkins API token Basic authentication with a least-privilege read-only account.
- Console output is bounded and redacted before artifact persistence or model input.
- It never triggers, cancels, reconfigures, or deletes Jenkins jobs.

## Extension rules

When adding a provider or agent:

1. Define a small interface and keep provider-specific code behind it.
2. Use read-only access by default and make every write explicit, approval-gated, and independently auditable.
3. Validate all paths, identifiers, URLs, and tool inputs at the boundary; do not rely on an LLM prompt for enforcement.
4. Bound and sanitize external data before persisting or sending it to a model.
5. Add unit tests for contracts and an HTTP integration test when a new MCP transport is introduced.
6. Do not add real credentials, customer data, or company-specific defaults to the repository.
