# Agentic Orchestrator

A framework-independent TypeScript reference project for coordinating specialised AI agents through a controlled software-delivery workflow.

It is designed as a portfolio project for QA and automation engineers: clone it, connect your own Jira, local source project, CI system, and model provider, then adapt the agent rules to your organisation. No company-specific credentials, tickets, URLs, or domain assumptions are included.

## What it demonstrates

- Explicit workflow states and human approval gates.
- Role-specific agents for issue analysis, test design, automation discovery, implementation planning, draft generation, and code review.
- English natural-language chat requests that only propose actions; every action needs a separate `yes` confirmation.
- Optional read-only Jira and local-project MCP adapters.
- A staged test-draft workflow with review, preview, safe application, and targeted flaky-test validation.
- SQLite workflow persistence and generated artifacts for each run.

## Workflow

```text
ISSUE_ANALYSIS
  → TEST_PLAN
  → PROJECT_DISCOVERY
  → CODE_CHANGE
  → CODE_REVIEW
  → LOCAL_TESTS
  → PULL_REQUEST
  → CI_ANALYSIS
  → ISSUE_COMMENT
  → COMPLETE
```

Every stage waits for human approval before the workflow moves to the next stage. A `REQUEST_CHANGES` or `BLOCKED` review returns the workflow to `CODE_CHANGE`, preserving feedback so the draft can be updated and reviewed again.

## Quick start

```bash
npm install
copy .env.example .env
npm run build
npm test
```

Fill in only the integrations you plan to use in `.env`. The file is ignored by Git.

Start a workflow through chat:

```bash
npm run chat -- "Start work for PROJECT-123"
# Reply to the proposal with: yes
```

Or use the direct workflow command:

```bash
npm run workflow -- start PROJECT-123
npm run workflow -- status PROJECT-123
```

## Natural-language workflow examples

The orchestrator supports English natural-language requests. It interprets one intent, displays the planned action, and waits for confirmation. It never executes an action as part of interpretation.

```text
Analyze PROJECT-123
Design tests for PROJECT-123
Discover automation for PROJECT-123
Generate a test draft for PROJECT-123
Preview draft for PROJECT-123
Review the code for PROJECT-123
Apply draft for PROJECT-123
Run tests/login.spec.ts for PROJECT-123
Prepare a pull request for PROJECT-123
Approve CODE_REVIEW for PROJECT-123
```

For a write or test operation, reply `yes` to the displayed proposal. Reply `cancel` to discard it.

## Draft-to-test flow

1. At `CODE_CHANGE`, generate a draft or stage one manually.
2. Preview the exact draft against the local project.
3. Run code review. An approval is bound to the draft's SHA-256 fingerprint.
4. Approve `CODE_REVIEW` to move to `LOCAL_TESTS`.
5. Apply the draft only after preview, matching approval, and stage approval.
6. Run only the new or changed test target. It must pass `TEST_SUCCESS_REPETITIONS` consecutive times (default: `3`).

The direct equivalents are:

```bash
npm run workflow -- generate-draft PROJECT-123
npm run workflow -- preview-draft PROJECT-123
npm run workflow -- review PROJECT-123
npm run workflow -- approve PROJECT-123 CODE_REVIEW
npm run workflow -- apply-draft PROJECT-123 --confirm
npm run workflow -- verify PROJECT-123 tests/login.spec.ts
npm run workflow -- prepare-pr PROJECT-123
```

`prepare-pr` creates `pull-request-description.md` from the implementation, review, and targeted-test artifacts. It never creates a branch, pushes code, or opens a real pull request; those Git provider integrations remain opt-in future adapters.

If targeted validation fails, the workflow becomes `REJECTED`. Review the artifact, then explicitly retry it:

```bash
npm run workflow -- recover PROJECT-123
```

## MCP adapters

### Local project MCP

`project-mcp` gives agents a bounded, read-only view of the project named by `PROJECT_SOURCE_ROOT`.

```bash
npm run project:mcp
```

It supports listing tests, source search, relevant-file discovery, and bounded source excerpts. It rejects traversal and symlink escapes, skips dependency/generated folders, and reads only supported source files.

### Jira MCP

`jira-mcp` is optional and read-only. Configure `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, and a mandatory `JIRA_ALLOWED_PROJECT_KEYS` scope.

```bash
npm run jira:mcp
```

It exposes scoped issue, search, and attachment reads. It does not accept arbitrary JQL and provides no Jira write operation.

### Docker

Run the local-project adapter in Docker:

```bash
docker compose up --build
```

The project source is mounted read-only and the service port is published only on `127.0.0.1`. Start the optional Jira adapter as well:

```bash
docker compose --profile jira up --build
```

## Safety model

- MCP servers bind to loopback by default. Docker only exposes ports on loopback.
- Jira access is restricted to configured project keys and read-only operations.
- Test drafts can write only supported test-file extensions beneath the configured source root; symlinked path components are rejected.
- Applying a draft requires an exact preview fingerprint and an exact approved code-review fingerprint.
- Test targets must be repository-relative, contain no traversal segments, and resolve inside `PROJECT_SOURCE_ROOT`, including after symlink resolution.
- `PROJECT_TEST_COMMAND_TEMPLATE` must include `{test}`. Only the validated test target is substituted into it.

## Configuration

See [`.env.example`](.env.example) for all variables. The main local settings are:

```dotenv
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
PROJECT_SOURCE_ROOT=
WORKFLOW_ARTIFACTS_PATH=./data/artifacts
TEST_SUCCESS_REPETITIONS=3
PROJECT_TEST_COMMAND_TEMPLATE=npx playwright test {test}
```

`PROJECT_SOURCE_ROOT` is required for previewing, applying, or running a targeted local test.

## Development

```bash
npm run build
npm test
```

The automated suite covers workflow transitions, persistence, MCP source boundaries, safe test writes, draft-review fingerprints, code-review remediation, chat confirmation, and flaky-test enforcement.
