import { openai } from '@ai-sdk/openai';
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';

import { parseStackTraceTool } from '../tools/stack-trace-parser-tool.js';
import { githubGetRepoByUrlTool } from '../tools/github-get-repo-by-url-tool.js';
import { githubSearchCodeTool } from '../tools/github-search-code-tool.js';
import { githubFileTool } from '../tools/github-file-tool.js';
import { githubDecodedFileTool } from '../tools/github-decoded-file-tool.js';
import { githubMCP } from '../mcps/github-mcp-client.js';

export const discoveryAgent = new Agent({
  name: 'Discovery Agent',
  instructions: `
You are the Discovery step. Input will be a stack trace and optionally a repo URL.

Your goals:
- Parse the stack trace (parse-stack-trace)
- Resolve repository (github-get-repo-by-url) if a URL is given or guessed
- Identify the top-most application frame path; if the path is absolute or not found, search by filename (github-search-code)
- Fetch the implicated file content (get-github-file-decoded); if that fails, return metadata from get-github-file

Output a concise JSON summary at the end with fields: { owner, repo, candidatePath, line, column, sha, size }.
Keep tool usage minimal and do not expose tokens.
`,
  model: openai('gpt-5-nano'),
  // tools: {
  //   'parse-stack-trace': parseStackTraceTool,
  //   'github-get-repo-by-url': githubGetRepoByUrlTool,
  //   'github-search-code': githubSearchCodeTool,
  //   'get-github-file': githubFileTool,
  //   'get-github-file-decoded': githubDecodedFileTool,
  // },
  tools: await githubMCP.getTools(),
  memory: new Memory({
    storage: new LibSQLStore({ url: 'file:../mastra.db' }),
  }),
});


