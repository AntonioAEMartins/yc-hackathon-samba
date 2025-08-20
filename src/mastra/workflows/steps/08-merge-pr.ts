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

// Step 8: Merge PR automatically (attempt approve then merge)
export const mergePr = createStep({
  id: 'merge-pr',
  description: 'Automatically approve (best-effort) and merge the PR',
  inputSchema: z.object({
    runId: z.string(),
    owner: z.string(),
    repo: z.string(),
    branch: z.string(),
    token: z.string().optional(),
    number: z.number(),
    url: z.string(),
    state: z.string(),
  }),
  outputSchema: z.object({
    number: z.number(),
    url: z.string(),
    merged: z.boolean(),
    sha: z.string().optional(),
    message: z.string().optional(),
  }),
  execute: async ({ inputData }) => {
    const token = resolveToken(inputData?.token);
    try { console.log('[samba/merge-pr] in', { runId: inputData.runId, number: inputData.number, owner: inputData.owner, repo: inputData.repo }); } catch {}

    // Best-effort approve (ignore failures, as many repos do not require/allow explicit approvals via token)
    try {
      const reviewsUrl = `https://api.github.com/repos/${encodeURIComponent(inputData.owner)}/${encodeURIComponent(inputData.repo)}/pulls/${inputData.number}/reviews`;
      await fetch(reviewsUrl, {
        method: 'POST',
        headers: { ...buildHeaders(token, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'APPROVE', body: 'Automated approval' }),
      });
    } catch {}

    // Merge
    const mergeUrl = `https://api.github.com/repos/${encodeURIComponent(inputData.owner)}/${encodeURIComponent(inputData.repo)}/pulls/${inputData.number}/merge`;
    const res = await fetch(mergeUrl, {
      method: 'PUT',
      headers: { ...buildHeaders(token, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ merge_method: 'merge' }),
    });
    await throwIfNotOk(res);
    const data = await res.json();
    const out = { number: inputData.number, url: inputData.url, merged: !!data.merged, sha: data.sha, message: data.message };
    try { console.log('[samba/merge-pr] out', { runId: inputData.runId, ...out }); } catch {}
    return out;
  },
});
