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

const throwIfNotOk = async (res: Response) => {
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

export const getDefaultBranch = async (
  owner: string,
  repo: string,
  token?: string,
): Promise<string> => {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const res = await fetch(url, { headers: buildHeaders(token, false) });
  await throwIfNotOk(res);
  const data = await res.json();
  return data.default_branch as string;
};

// Part A: Create Branch
export const githubCreateBranchTool = createTool({
  id: 'github-create-branch',
  description: 'Create a branch from a base ref (defaults to repo default branch)',
  inputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    newBranch: z.string(),
    fromRef: z.string().optional(),
    token: z.string().optional(),
  }),
  outputSchema: z.object({
    ref: z.string(),
    sha: z.string(),
  }),
  execute: async ({ context }) => {
    const { owner, repo, newBranch, token: inputToken } = context;
    let { fromRef } = context;
    const token = resolveToken(inputToken);

    if (!token) {
      // Creating branches on private repos or on behalf of a user requires auth.
      throw new Error('Missing GitHub token');
    }

    if (!fromRef) {
      fromRef = await getDefaultBranch(owner, repo, token);
    }

    // Resolve base ref SHA
    const refUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
      repo,
    )}/git/ref/heads/${encodeURIComponent(fromRef)}`;
    const refRes = await fetch(refUrl, { headers: buildHeaders(token, true) });
    await throwIfNotOk(refRes);
    const refData = await refRes.json();
    const baseSha: string = refData.object?.sha || refData.sha;

    // Create new ref
    const createUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
      repo,
    )}/git/refs`;
    const createRes = await fetch(createUrl, {
      method: 'POST',
      headers: {
        ...buildHeaders(token, true),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha: baseSha }),
    });
    await throwIfNotOk(createRes);
    const createData = await createRes.json();

    return { ref: createData.ref, sha: createData.object?.sha || baseSha };
  },
});

// Part B: Commit File
export const githubCommitFileTool = createTool({
  id: 'github-commit-file',
  description: 'Create or update a single file on a branch',
  inputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    path: z.string(),
    content: z.string(),
    branch: z.string().optional(),
    message: z.string().default('update via agent').optional(),
    sha: z.string().optional(),
    token: z.string().optional(),
  }),
  outputSchema: z.object({
    content: z.any(),
    commit: z.any(),
  }),
  execute: async ({ context }) => {
    const { owner, repo, path, content, message, token: inputToken } = context;
    let { branch, sha } = context;
    const token = resolveToken(inputToken);
    if (!token) throw new Error('Missing GitHub token');

    if (!branch) {
      branch = await getDefaultBranch(owner, repo, token);
    }

    // Guidance: If updating and sha is unknown, the caller can first read the file to get its current sha.
    const encodedPath = encodePath(path);
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
      repo,
    )}/contents/${encodedPath}`;

    const body: Record<string, unknown> = {
      message: message ?? 'update via agent',
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch,
    };
    if (sha) body.sha = sha;

    const res = await fetch(url, {
      method: 'PUT',
      headers: { ...buildHeaders(token, true), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    await throwIfNotOk(res);
    const data = await res.json();
    return { content: data.content, commit: data.commit };
  },
});

// Part C: Create PR
export const githubCreatePrTool = createTool({
  id: 'github-create-pr',
  description: 'Open a pull request',
  inputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    title: z.string(),
    head: z.string(),
    base: z.string().optional(),
    body: z.string().optional(),
    draft: z.boolean().optional(),
    token: z.string().optional(),
  }),
  outputSchema: z.object({
    number: z.number(),
    url: z.string(),
    state: z.string(),
  }),
  execute: async ({ context }) => {
    const { owner, repo, title, head, body, draft, token: inputToken } = context;
    let { base } = context;
    const token = resolveToken(inputToken);
    if (!token) throw new Error('Missing GitHub token');

    if (!base) {
      base = await getDefaultBranch(owner, repo, token);
    }

    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
      repo,
    )}/pulls`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...buildHeaders(token, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, head, base, body, draft }),
    });
    await throwIfNotOk(res);
    const data = await res.json();
    return { number: data.number, url: data.html_url ?? data.url, state: data.state };
  },
});

// Part D: Approve PR
export const githubApprovePrTool = createTool({
  id: 'github-approve-pr',
  description: 'Create a PR review with APPROVE',
  inputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    pull_number: z.number(),
    body: z.string().default('LGTM').optional(),
    token: z.string().optional(),
  }),
  outputSchema: z.object({
    id: z.number(),
    state: z.string(),
  }),
  execute: async ({ context }) => {
    const { owner, repo, pull_number, token: inputToken } = context;
    const body = context.body ?? 'LGTM';
    const token = resolveToken(inputToken);
    if (!token) throw new Error('Missing GitHub token');

    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
      repo,
    )}/pulls/${pull_number}/reviews`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...buildHeaders(token, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'APPROVE', body }),
    });
    await throwIfNotOk(res);
    const data = await res.json();
    return { id: data.id, state: data.state };
  },
});

export type GithubCreateBranchInput = z.infer<typeof githubCreateBranchTool.inputSchema>;
export type GithubCommitFileInput = z.infer<typeof githubCommitFileTool.inputSchema>;
export type GithubCreatePrInput = z.infer<typeof githubCreatePrTool.inputSchema>;
export type GithubApprovePrInput = z.infer<typeof githubApprovePrTool.inputSchema>;


