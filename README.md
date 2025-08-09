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
All agents use `openai('gpt-5-nano')` and `LibSQLStore` memory.

- Discovery (`src/mastra/agents/discovery-agent.ts`): parse stack, resolve repo, locate file; tools: parse stack, repo by URL, code search, get file/decoded.
- Execution (`src/mastra/agents/execution-agent.ts`): generate minimal fix, commit/update file on feature branch; tools: commit-or-update file, get decoded file.
- Finalize (`src/mastra/agents/finalize-agent.ts`): open PR to default branch; tool: create PR.
- GitHub (`src/mastra/agents/github-agent.ts`): end-to-end assistant (parse, search, patch, PR); rich GitHub + parsing toolset.

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
- Flow: users hit an error → Sentry posts webhook → Samba turns signal into a PR (no auto‑deploy).
- Data received: stack, title/message, breadcrumbs, exception values, project metadata.
- Checklist: (1) Enable Sentry in prod, (2) Add Webhook action to `https://<your-samba-host>/webhook`, (3) Set matching `WEBHOOK_SECRET`, (4) Configure `SENTRY_PROJECT_REPO_MAP` or `SENTRY_DEFAULT_REPO_URL`.
- Boundaries: Sentry setup lives in your app; Samba consumes webhooks and opens PRs; tokens are never logged.

### Test Application (Next.js)
Minimal demo: Next.js repo [yc-hackathon-social](https://github.com/AntonioAEMartins/yc-hackathon-social) with an intentional simple bug to showcase the automated fix loop.

### Getting Started
Prerequisites: Node ≥ 20.9, GitHub token (repo scope), OpenAI API key (GPT‑5 access)

Run:

```bash
npm install
npm run dev
# or
npm run start
```

Webhook: served at `/webhook`.

Env vars:
- `OPENAI_API_KEY` or `OPENAI_API_KEY_GPT5` (model via `GPT5_MODEL`, default `gpt-5`)
- `GITHUB_TOKEN` or `GITHUB_PERSONAL_ACCESS_TOKEN`
- `WEBHOOK_SECRET` (optional)
- `SENTRY_PROJECT_REPO_MAP` (JSON) or `SENTRY_DEFAULT_REPO_URL`
  - Example: `{ "my-sentry-project": { "owner": "org", "repo": "service", "branch": "main" }, "default": "https://github.com/org/service" }`

### Quick Demo (Local)
1) Export env vars; start Samba: `npm run dev`
2) Trigger:

```bash
curl -X POST "http://localhost:PORT/webhook" \
  -H 'Content-Type: application/json' \
  -H 'Sentry-Hook-Resource: event_alert' \
  -d '{
    "resource": "event_alert",
    "data": { "event": { "message": "TypeError at src/app/page.tsx:42" } },
    "project": "demo"
  }'
```

Replace `PORT` accordingly. If `WEBHOOK_SECRET` is set, include the matching signature header.

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
- Fixed orchestration; LLM/tool outputs and external APIs can vary.
- Mitigations: smallest‑safe‑change prompts, strict API checks, conservative fallbacks, idempotent branches, no auto‑merge/deploy.
- Observability: `runId` + step logs (no secrets) for replay/debugging.
- Repro: pin `GPT5_MODEL`; identical inputs may still vary slightly.

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