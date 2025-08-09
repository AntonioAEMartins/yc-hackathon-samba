import { openai } from '@ai-sdk/openai';
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import { githubFileTool } from '../tools/github-file-tool.js';
import { githubDecodedFileTool } from '../tools/github-decoded-file-tool.js';
import { githubListReposTool } from '../tools/github-list-repos-tool.js';
import { githubSearchCodeTool } from '../tools/github-search-code-tool.js';
import { githubGetRepoByUrlTool } from '../tools/github-get-repo-by-url-tool.js';
import {
  githubCommitToDevTool,
  githubOpenDevPrToMainTool,
  githubMergePrTool,
} from '../tools/github-dev-tools.js';
import {
  githubCreateBranchTool,
  githubCommitFileTool,
  githubCreatePrTool,
  githubApprovePrTool,
} from '../tools/github-git-ops-tools.js';
import { githubCommitOrUpdateFileTool } from '../tools/github-commit-or-update-file-tool.js';
import { parseStackTraceTool } from '../tools/stack-trace-parser-tool.js';

export const githubAgent = new Agent({
  name: 'GitHub Agent',
  instructions: `
You are a GitHub code-fixing assistant. Given a stack trace and a repository, you must locate the implicated file(s), propose a minimal, safe fix, commit the change on a short-lived branch, and open a PR.

Operating procedure:
1) Parse the provided stack trace using parse-stack-trace. If the repo URL is embedded in the trace, extract it; otherwise, ask the user for the repo URL.
2) Identify the top-most app frame inside the repo to determine candidate file and line. If direct path fetch fails, normalize the path (strip absolute segments, resolve \`src/\` roots) or search by filename with github-search-code. Fetch file content using get-github-file-decoded.
3) Propose a targeted fix. Keep edits small and backwards compatible.
4) Create a feature branch (github-commit-or-update-file) and commit the change with a clear message referencing the error.
5) Open a PR from the feature branch to the default branch (github-create-pr). Include context: error, minimal reproduction if discernible, and reasoning for fix.
6) Never expose tokens. Avoid destructive changes. Prefer adding guards and tests, not deleting logic.

Follow these rules:
- Prefer minimal scope and least privilege.
- Never print or log tokens.
- For file paths, preserve slashes and encode segments.
  `,
  model: openai('gpt-5-nano'),
  tools: {
    'get-github-file': githubFileTool,
    'get-github-file-decoded': githubDecodedFileTool,
    'github-list-repos': githubListReposTool,
    'github-search-code': githubSearchCodeTool,
    'github-create-branch': githubCreateBranchTool,
    'github-commit-file': githubCommitFileTool,
    'github-create-pr': githubCreatePrTool,
    'github-approve-pr': githubApprovePrTool,
    'github-get-repo-by-url': githubGetRepoByUrlTool,
    'github-commit-to-dev': githubCommitToDevTool,
    'github-open-dev-pr-to-main': githubOpenDevPrToMainTool,
    'github-merge-pr': githubMergePrTool,
    'parse-stack-trace': parseStackTraceTool,
    'github-commit-or-update-file': githubCommitOrUpdateFileTool,
  },
  memory: new Memory({
    storage: new LibSQLStore({
      url: 'file:../mastra.db',
    }),
  }),
});


