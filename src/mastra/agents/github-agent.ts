import { openai } from '@ai-sdk/openai';
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import { githubFileTool } from '../tools/github-file-tool.js';
import { githubListReposTool } from '../tools/github-list-repos-tool.js';
import { githubSearchCodeTool } from '../tools/github-search-code-tool.js';
import { githubGetRepoByUrlTool } from '../tools/github-get-repo-by-url-tool.js';
import {
  githubCreateBranchTool,
  githubCommitFileTool,
  githubCreatePrTool,
  githubApprovePrTool,
} from '../tools/github-git-ops-tools.js';

export const githubAgent = new Agent({
  name: 'GitHub Agent',
  instructions: `
You are a GitHub operations assistant. Use the registered tools to read public or private repositories, create branches, commit files, and manage pull requests.

Follow these rules:
- Prefer minimal scope and least privilege.
- Never print or log tokens.
- For file paths, preserve slashes and encode segments.
  `,
  model: openai('gpt-4o-mini'),
  tools: {
    'get-github-file': githubFileTool,
    'github-list-repos': githubListReposTool,
    'github-search-code': githubSearchCodeTool,
    'github-create-branch': githubCreateBranchTool,
    'github-commit-file': githubCommitFileTool,
    'github-create-pr': githubCreatePrTool,
    'github-approve-pr': githubApprovePrTool,
    'github-get-repo-by-url': githubGetRepoByUrlTool,
  },
  memory: new Memory({
    storage: new LibSQLStore({
      url: 'file:../mastra.db',
    }),
  }),
});


