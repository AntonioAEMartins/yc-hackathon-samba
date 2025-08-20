import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { githubAgent } from '../../agents/github-agent';
import { GitHubAgentOutputSchema } from '../../github-agent-output-schema';


// Step 3: Locate file path
export const locateFile = createStep({
  id: 'locate-file',
  description: 'Choose candidate path or search by filename in repo',
  inputSchema: z.object({
    runId: z.string(),
    prompt: z.string(),
    owner: z.string().optional(),
    repo: z.string().optional(),
    token: z.string().optional(),
    prTitle: z.string().optional(),
    prBody: z.string().optional(),
    errorHeader: z.string().optional(),
    repoUrl: z.string().optional(),
    repoRef: z.string().optional(),
    explicitPath: z.string().optional(),
    fileCandidates: z.array(z.object({ pathOrName: z.string(), line: z.number().optional(), column: z.number().optional() })),
  }),
  outputSchema: GitHubAgentOutputSchema,
  execute: async ({ inputData }) => {
    // Resolve owner/repo from repoUrl if not provided directly
    let owner = inputData.owner;
    let repo = inputData.repo;
    
    if ((!owner || !repo) && inputData.repoUrl) {
      const u = new URL(inputData.repoUrl);
      const parts = u.pathname.split('/').filter(Boolean);
      owner = parts[0];
      repo = parts[1];
    }
    
    if (!owner || !repo) {
      throw new Error('Owner/repo must be provided either directly or through repoUrl');
    }
    
    // Use repoRef as baseBranch, or default to 'main'
    const baseBranch = inputData.repoRef || 'main';

    const contextData = {
      ...inputData,
      owner,
      repo,
      baseBranch,
      fileCandidates: inputData.fileCandidates,
      receivedAt: new Date().toISOString()
    };

    const inputDataString = JSON.stringify(contextData);
    const agent = githubAgent;
    const result = await agent.generate(inputDataString, {
      experimental_output: GitHubAgentOutputSchema,
    });
    
    if (!result.object) {
      throw new Error('Agent failed to generate valid output');
    }
    
    return result.object;
  },
});
