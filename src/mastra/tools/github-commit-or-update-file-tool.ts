import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const resolveToken = (inputToken?: string): string | undefined => {
  return (
    inputToken ||
    process.env.GITHUB_TOKEN ||
    process.env.GITHUB_PERSONAL_ACCESS_TOKEN ||
    undefined
  );
};

const buildHeaders = (token?: string, requireAuth: boolean = false): Record<string, string> => {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else if (requireAuth) {
    throw new Error('Missing GitHub token');
  }
  return headers;
};

const throwIfNotOk = async (res: any) => {
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API error ${res.status}: ${body}`);
  }
};

const encodePath = (path: string): string => {
  return path
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
};

async function getDefaultBranch(owner: string, repo: string, token?: string): Promise<string> {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const res = await fetch(url, { headers: buildHeaders(token, false) });
  await throwIfNotOk(res);
  const data = await res.json();
  return data.default_branch as string;
}

async function branchExists(owner: string, repo: string, branch: string, token?: string): Promise<boolean> {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(branch)}`;
  const res = await fetch(url, { headers: buildHeaders(token, true) });
  return res.ok;
}

async function createBranchFrom(owner: string, repo: string, newBranch: string, fromRef: string, token?: string): Promise<void> {
  const refUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(fromRef)}`;
  const refRes = await fetch(refUrl, { headers: buildHeaders(token, true) });
  await throwIfNotOk(refRes);
  const refData = await refRes.json();
  const baseSha: string = refData.object?.sha || refData.sha;

  const createUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs`;
  const createRes = await fetch(createUrl, {
    method: 'POST',
    headers: { ...buildHeaders(token, true), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha: baseSha }),
  });
  await throwIfNotOk(createRes);
}

export const githubCommitOrUpdateFileTool = createTool({
  id: 'github-commit-or-update-file',
  description: 'Create a feature branch if needed, update or create a single file, and return commit info',
  inputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    path: z.string(),
    newContent: z.string(),
    branch: z.string().optional(),
    baseRef: z.string().optional(),
    commitMessage: z.string().default('update via agent').optional(),
    token: z.string().optional(),
  }),
  outputSchema: z.object({
    branch: z.string(),
    commitSha: z.string(),
    newSha: z.string(),
  }),
  execute: async ({ context }) => {
    const { owner, repo, path, newContent, token: inputToken } = context;
    let { branch, baseRef } = context;
    const commitMessage = context.commitMessage ?? 'update via agent';
    const token = resolveToken(inputToken);
    if (!token) throw new Error('Missing GitHub token');

    const defaultBranch = await getDefaultBranch(owner, repo, token);
    if (!baseRef) baseRef = defaultBranch;
    if (!branch) branch = `fix/${Date.now()}`;

    // Ensure branch
    if (!(await branchExists(owner, repo, branch, token))) {
      await createBranchFrom(owner, repo, branch, baseRef, token);
    }

    // Read existing to get sha if present
    const encodedPath = encodePath(path);
    const params = new URLSearchParams();
    params.set('ref', branch);
    const getUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}?${params.toString()}`;
    let existingSha: string | undefined;
    const getRes = await fetch(getUrl, { headers: buildHeaders(token, true) });
    if (getRes.ok) {
      const data = await getRes.json();
      existingSha = data.sha;
    }

    // Commit
    const putUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}`;
    const res = await fetch(putUrl, {
      method: 'PUT',
      headers: { ...buildHeaders(token, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: commitMessage,
        content: Buffer.from(newContent, 'utf8').toString('base64'),
        branch,
        ...(existingSha ? { sha: existingSha } : {}),
      }),
    });
    await throwIfNotOk(res);
    const data = await res.json();
    return { branch, commitSha: data.commit?.sha, newSha: data.content?.sha };
  },
});

export type GithubCommitOrUpdateFileInput = z.infer<typeof githubCommitOrUpdateFileTool.inputSchema>;
export type GithubCommitOrUpdateFileOutput = z.infer<typeof githubCommitOrUpdateFileTool.outputSchema>;


