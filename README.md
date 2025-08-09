### Samba — Autonomous Reactive Code-Fixer (YC AI Coding Agents Hackathon)

Build once, then let production fix itself. Samba listens to error signals (e.g., Sentry alerts), finds the faulty line, proposes a minimal fix with GPT‑5, commits on a short‑lived branch, and opens a PR—end to end.

– Track: Autonomous Reactive Agents  
– Event: AI Coding Agents Hackathon @ YC Office  
– Test App: Next.js demo repo [yc-hackathon-social](https://github.com/AntonioAEMartins/yc-hackathon-social)

### TL;DR
- In production, users hit an error. Sentry captures it and sends an `event_alert` webhook to Samba. (Sentry setup is external to this repo and required.)
- Samba parses stack + metadata, resolves `owner/repo/branch`, locates the implicated file/line, and fetches it from GitHub.
- GPT‑5 proposes the smallest safe edit; Samba commits on a short‑lived branch and opens a PR. No auto‑deploy.
- You review and merge the PR. The fix ships via your normal CI/CD.

### Why (Problem Statement)
We’ve used tools like Cursor BugBot and CodeRabbit PR Reviewer; they’re great, but none provided a seamless signal-to-fix loop that runs without a developer in the middle. Our insight: the next step is a composable, event-driven agent workflow that closes the loop from error to PR with minimal human intervention.

### Architecture
Core is a Mastra workflow with a fixed, auditable orchestration path from signal to PR; agent/tool executions are LLM-driven and may vary in output:

1) Parse input  
2) Resolve repo and base branch  
3) Locate implicated file  
4) Read file content  
5) Propose fix (GPT‑5)  
6) Commit fix to feature branch  
7) Open PR

Key file: `src/mastra/workflows/fix-from-stacktrace-workflow-v2.ts`

High-level steps implemented there:
- parse-input: Extracts repo URL, optional ref, explicit file path, and stack frames
- resolve-repo: Hits GitHub API to resolve owner/repo and default branch (or provided ref)
- locate-file: Tries direct path; otherwise GitHub Code Search by filename
- read-file: Reads decoded file via GitHub Contents API
- propose-fix: Calls `propose-fix-gpt5` tool to generate the smallest safe change
- commit-fix: Creates a short-lived branch and commits updated content
- open-pr: Opens a PR against the default branch

### Agents (Mastra)
All agents use `openai('gpt-5-nano')` for fast, low-latency orchestration. They call specialized tools (below) and persist memory in `LibSQLStore`.

- Discovery Agent (`src/mastra/agents/discovery-agent.ts`)
  - Goal: Parse stack trace, identify repo and candidate file, fetch decoded file
  - Tools: `parse-stack-trace`, `github-get-repo-by-url`, `github-search-code`, `get-github-file`, `get-github-file-decoded`

- Execution Agent (`src/mastra/agents/execution-agent.ts`)
  - Goal: Generate minimal fix and commit to a temp branch
  - Tools: `github-commit-or-update-file`, `get-github-file-decoded`

- Finalize Agent (`src/mastra/agents/finalize-agent.ts`)
  - Goal: Open PR from feature branch to default
  - Tool: `github-create-pr`

- GitHub Agent (`src/mastra/agents/github-agent.ts`)
  - Goal: End-to-end GitHub code-fixing assistant (parse, search, patch, PR)
  - Tools: `get-github-file`, `get-github-file-decoded`, `github-list-repos`, `github-search-code`, `github-create-branch`, `github-commit-file`, `github-create-pr`, `github-approve-pr`, `github-get-repo-by-url`, `github-commit-or-update-file`, `github-merge-pr`, `parse-stack-trace`, `github-open-dev-pr-to-main`, `github-commit-to-dev`

### Tooling Highlights
- `propose-fix-gpt5` (`src/mastra/tools/propose-fix-gpt5-tool.ts`)
  - Calls OpenAI GPT‑5 to propose a minimal edit; outputs the full updated file content
  - Honors line context, language hints, and un-fences markdown if returned

- GitHub helpers: search, contents (decoded), commit/update, branch/PR operations

### Signal Ingestion (Webhook)
Samba exposes a webhook: `POST /webhook`

- Verifies HMAC signature if `WEBHOOK_SECRET` is set
- Detects Sentry `event_alert` payloads, extracts stack/file hints
- Maps Sentry project → repo via `SENTRY_PROJECT_REPO_MAP` (or falls back to `SENTRY_DEFAULT_REPO_URL`)
- Builds a prompt and triggers `fix-from-stacktrace-v2`

See `src/mastra/index.ts` for route wiring. On successful detection, the workflow either starts natively or via the manual runner `startFixFromStacktraceV2`.

### Production Integration (Sentry)
- Who interacts: your end users use your app in production as usual.
- On error: the Sentry SDK in your app captures the exception and an Alert Rule posts a webhook to Samba. This Sentry setup is external to this project (not part of this repo) and acts as a required building block to trigger our workflow.
- What Samba receives: stack trace, message/title, breadcrumbs, exception values, and project metadata via Sentry’s webhook payload and headers.
- What Samba does: verifies signature (if configured), derives repo/file/line, fetches the implicated file from GitHub, asks GPT‑5 for the smallest safe fix, commits on a short‑lived branch, and opens a PR. It does not hot‑patch production or auto‑deploy.

Quick Sentry setup checklist:
1) Enable Sentry in your app and send events in production.
2) Create an Error Alert Rule and add a Webhook action pointing to your Samba URL: `https://<your-samba-host>/webhook`.
3) Add a secret header in Sentry and set the same value in Samba as `WEBHOOK_SECRET` for HMAC verification.
4) Map Sentry projects to repos with `SENTRY_PROJECT_REPO_MAP`, or set a single fallback `SENTRY_DEFAULT_REPO_URL`.

Data mapping in Samba:
- owner/repo: resolved from `SENTRY_PROJECT_REPO_MAP` or `SENTRY_DEFAULT_REPO_URL`
- file path: extracted from breadcrumbs, message/title, metadata, or exception values

Boundaries & privacy:
- Sentry configuration belongs to your application; Samba only consumes the webhook
- Samba opens PRs only; humans review/merge
- Access tokens are never logged; only the necessary file content is fetched

### Test Application (Next.js)
We built a minimal app to validate the end-to-end loop: `yc-hackathon-social` on Next.js.  
Repo: [github.com/AntonioAEMartins/yc-hackathon-social](https://github.com/AntonioAEMartins/yc-hackathon-social)

In that repo we include a deliberately simple issue (e.g., “Change this line to a number, instead of a string: "Good Morning!"”) to demonstrate an automated fix.

### Getting Started
Prerequisites:
- Node.js ≥ 20.9.0
- GitHub token with repo permissions
- OpenAI API key with GPT‑5 access

Install and run:

```bash
npm install
npm run dev
# or
npm run start
```

Mastra will start the local server and print the listening URL. The webhook is served at `/webhook`.

Environment variables:
- `OPENAI_API_KEY` or `OPENAI_API_KEY_GPT5`: API key for GPT‑5
- `GPT5_MODEL` (optional): default `gpt-5`
- `GITHUB_TOKEN` or `GITHUB_PERSONAL_ACCESS_TOKEN`: used for GitHub API
- `WEBHOOK_SECRET` (optional): shared secret to verify incoming webhook signatures
- `SENTRY_PROJECT_REPO_MAP` (optional): JSON map from Sentry project → `{ owner, repo, branch? }` or a GitHub URL
  - Example: `{ "my-sentry-project": { "owner": "org", "repo": "service", "branch": "main" }, "default": "https://github.com/org/service" }`
- `SENTRY_DEFAULT_REPO_URL` (optional): fallback GitHub repo URL `https://github.com/<owner>/<repo>`

### Quick Demo (Local)
1) Export env vars (GitHub + OpenAI). Optionally set `SENTRY_DEFAULT_REPO_URL=https://github.com/AntonioAEMartins/yc-hackathon-social`.
2) Start Samba: `npm run dev`
3) Send a minimal webhook to trigger the flow:

```bash
curl -X POST "http://localhost:PORT/webhook" \
  -H 'Content-Type: application/json' \
  -H 'Sentry-Hook-Resource: event_alert' \
  -d '{
    "resource": "event_alert",
    "data": {
      "event": {
        "message": "TypeError at src/app/page.tsx:42",
        "breadcrumbs": { "values": [ { "data": { "arguments": [ { "stack": "at src/app/page.tsx:42:5\n..." } ] } } ] },
        "metadata": { "title": "Demo error" }
      }
    },
    "project": "demo"
  }'
```

Replace `PORT` with the printed server port. If `WEBHOOK_SECRET` is set, also add the correct `Sentry-Hook-Signature` header.

### How It Works (End to End)
- Webhook arrives → `parse-input` derives repo/path/line from Sentry event and optional mapping
- GitHub API fetches file at the inferred path and ref
- GPT‑5 proposes a minimal safe edit
- GitHub Contents API commits the change on a new `fix/<timestamp>` branch
- A PR is opened to the default branch with context

### Design Choices
- Minimal diffs: bias towards the smallest viable fix; preserve formatting and imports
- Guard rails: never log tokens; prefer additive changes and safe checks over deletions
- Deterministic steps: every API call is explicit and traced; fallback paths are conservative

### Determinism and Reliability
- Deterministic orchestration: the path Parse → Resolve → Locate → Read → Propose → Commit → PR is fixed and auditable.
- Non‑deterministic agents/tools: model outputs, GitHub search ranking, and external API responses can vary across runs.
- Mitigations: smallest‑safe‑change instruction set, strict API checks, conservative fallbacks (direct path → code search), idempotent branch naming, and no auto‑merge/deploy.
- Observability: each run has a `runId`; logs include step boundaries and inputs/outputs (sans secrets) for replay/debugging.
- Repro tips: pin `GPT5_MODEL`, keep inputs stable, and note that identical inputs may still yield slightly different edits.

### Known Limitations / Next Steps
- Tool call limits can apply depending on model/provider quotas
- Multi-file fixes are out of scope for the MVP; planned as iterative PRs
- Broader signal sources (CloudWatch, Datadog) can be added via additional webhook adapters

### Credits
- Built with Mastra for agent orchestration and tooling
- GitHub and OpenAI APIs for code operations and LLM fixes
- Demo app: Next.js repo [yc-hackathon-social](https://github.com/AntonioAEMartins/yc-hackathon-social)

### License
ISC