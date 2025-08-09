import { openai } from '@ai-sdk/openai';
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';

import { githubCreatePrTool } from '../tools/github-git-ops-tools.js';

export const finalizeAgent = new Agent({
  name: 'Finalize Agent',
  instructions: `
You are the Finalization step. Input will contain { owner, repo, headBranch, baseBranch?, prTitle, prBody? }.
Open a PR from headBranch to base (default to repo default). Include a clear title and succinct body.
Output JSON: { number, url, state }.
`,
  model: openai('gpt-5-nano'),
  tools: {
    'github-create-pr': githubCreatePrTool,
  },
  memory: new Memory({
    storage: new LibSQLStore({ url: 'file:../mastra.db' }),
  }),
});


