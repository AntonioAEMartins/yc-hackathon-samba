import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { buildHeaders, throwIfNotOk } from './utils.js';

const resolveToken = (inputToken?: string): string | undefined => {
  return (
    inputToken ||
    process.env.GITHUB_MCP_PAT ||
    undefined
  );
};

// Step 2: Resolve owner/repo and base branch
export const resolveRepo = createStep({
  id: 'resolve-repo',
  description: 'Resolve owner/repo and default branch (or ref from blob URL)',
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
  outputSchema: z.object({
    runId: z.string(),
    prompt: z.string(),
    owner: z.string(),
    repo: z.string(),
    baseBranch: z.string(),
    token: z.string().optional(),
    prTitle: z.string().optional(),
    prBody: z.string().optional(),
    errorHeader: z.string().optional(),
    fileCandidates: z.array(z.object({ pathOrName: z.string(), line: z.number().optional(), column: z.number().optional() })),
    explicitPath: z.string().optional(),
  }),
  execute: async ({ inputData }) => {
    if (!inputData) throw new Error('Input required');
    try { console.log('[samba/resolve-repo] in', { runId: inputData.runId, owner: !!inputData.owner, repo: !!inputData.repo, repoUrl: inputData.repoUrl }); } catch {}
    let owner = inputData.owner;
    let repo = inputData.repo;
    if ((!owner || !repo) && inputData.repoUrl) {
      const u = new URL(inputData.repoUrl);
      const parts = u.pathname.split('/').filter(Boolean);
      owner = parts[0];
      repo = parts[1];
    }
    if (!owner || !repo) throw new Error('Owner/repo missing');

    const token = resolveToken(inputData.token);
    const repoUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const repoRes = await fetch(repoUrl, { headers: buildHeaders(token, false) });
    await throwIfNotOk(repoRes);
    const repoData = await repoRes.json();
    let baseBranch: string = inputData.repoRef || (repoData.default_branch as string);

    const out = {
      runId: inputData.runId,
      prompt: inputData.prompt,
      owner,
      repo,
      baseBranch,
      token: inputData.token,
      prTitle: inputData.prTitle,
      prBody: inputData.prBody,
      errorHeader: inputData.errorHeader,
      fileCandidates: inputData.fileCandidates,
      explicitPath: inputData.explicitPath,
    };
    try { console.log('[samba/resolve-repo] out', { runId: inputData.runId, owner, repo, baseBranch }); } catch {}
    return out;
  },
});
