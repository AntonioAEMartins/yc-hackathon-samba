import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { buildHeaders, throwIfNotOk, encodePath } from './utils.js';

const resolveToken = (inputToken?: string): string | undefined => {
  return (
    inputToken ||
    process.env.GITHUB_MCP_PAT ||
    undefined
  );
};

// Step 6: Commit fix on a feature branch
export const commitFix = createStep({
  id: 'commit-fix',
  description: 'Create feature branch and commit updated file',
  inputSchema: z.object({
    runId: z.string(),
    owner: z.string(),
    repo: z.string(),
    baseBranch: z.string(),
    candidatePath: z.string(),
    fileSha: z.string(),
    updatedText: z.string(),
    token: z.string().optional(),
    prTitle: z.string().optional(),
    prBody: z.string().optional(),
  }),
  outputSchema: z.object({
    runId: z.string(),
    owner: z.string(),
    repo: z.string(),
    branch: z.string(),
    candidatePath: z.string(),
    commitSha: z.string(),
    newSha: z.string(),
    token: z.string().optional(),
    prTitle: z.string().optional(),
    prBody: z.string().optional(),
  }),
  execute: async ({ inputData }) => {
    const token = resolveToken(inputData?.token);
    try { console.log('[samba/commit-fix] in', { runId: inputData.runId, candidatePath: inputData.candidatePath, baseBranch: inputData.baseBranch }); } catch {}

    // If no change, abort early to avoid empty commit
    try {
      const original = inputData.fileSha; // presence of sha indicates we fetched an existing file
      const updatedText = inputData.updatedText ?? '';
      if ((updatedText || '').length === 0) {
        console.warn('[samba/commit-fix] empty updatedText, skipping commit', { runId: inputData.runId });
        return {
          runId: inputData.runId,
          owner: inputData.owner,
          repo: inputData.repo,
          branch: inputData.baseBranch,
          candidatePath: inputData.candidatePath,
          commitSha: '',
          newSha: original || '',
          token: inputData.token,
          prTitle: inputData.prTitle,
          prBody: inputData.prBody,
        };
      }
    } catch {}
    const branch = `fix/${Date.now()}`;

    // Create branch from default
    const refUrl = `https://api.github.com/repos/${encodeURIComponent(inputData.owner)}/${encodeURIComponent(inputData.repo)}/git/ref/heads/${encodeURIComponent(inputData.baseBranch)}`;
    const refRes = await fetch(refUrl, { headers: buildHeaders(token, true) });
    await throwIfNotOk(refRes);
    const refData = await refRes.json();
    const baseSha: string = refData.object?.sha || refData.sha;
    const createRefUrl = `https://api.github.com/repos/${encodeURIComponent(inputData.owner)}/${encodeURIComponent(inputData.repo)}/git/refs`;
    const createRes = await fetch(createRefUrl, {
      method: 'POST',
      headers: { ...buildHeaders(token, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
    });
    if (!createRes.ok && createRes.status !== 422) {
      await throwIfNotOk(createRes);
    }

    const putUrl = `https://api.github.com/repos/${encodeURIComponent(inputData.owner)}/${encodeURIComponent(inputData.repo)}/contents/${encodePath(inputData.candidatePath)}`;
    const putRes = await fetch(putUrl, {
      method: 'PUT',
      headers: { ...buildHeaders(token, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'fix: automated stack-trace fix',
        content: Buffer.from(inputData.updatedText, 'utf8').toString('base64'),
        sha: inputData.fileSha,
        branch,
      }),
    });
    await throwIfNotOk(putRes);
    const putData = await putRes.json();

    const out = {
      runId: inputData.runId,
      owner: inputData.owner,
      repo: inputData.repo,
      branch,
      candidatePath: inputData.candidatePath,
      commitSha: putData.commit?.sha,
      newSha: putData.content?.sha,
      token: inputData.token,
      prTitle: inputData.prTitle,
      prBody: inputData.prBody,
    };
    try { console.log('[samba/commit-fix] out', { runId: inputData.runId, branch, commitSha: putData.commit?.sha }); } catch {}
    return out;
  },
});
