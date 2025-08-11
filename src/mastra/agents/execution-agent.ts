import { openai } from '@ai-sdk/openai';
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';

import { githubCommitOrUpdateFileTool } from '../tools/github-commit-or-update-file-tool.js';
import { githubDecodedFileTool } from '../tools/github-decoded-file-tool.js';
import { githubMCP } from '../mcps/github-mcp-client.js';

export const executionAgent = new Agent({
  name: 'Execution Agent',
  instructions: `
You are the Execution step. Input will contain { owner, repo, candidatePath, line?, column?, originalText? } and the desired fix description.

Your goals:
- Generate a minimal, safe fix to the provided file content.
- Create or ensure a short-lived branch and commit the updated file (github-commit-or-update-file).

Output a concise JSON summary: { branch, commitSha, newSha, path }.
`,
  model: openai('gpt-5-nano'),
  // tools: {
  //   'github-commit-or-update-file': githubCommitOrUpdateFileTool,
  //   'get-github-file-decoded': githubDecodedFileTool,
  // },
  tools: await githubMCP.getTools(),
  memory: new Memory({
    storage: new LibSQLStore({ url: 'file:../mastra.db' }),
  }),
});


