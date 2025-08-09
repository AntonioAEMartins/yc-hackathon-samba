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

const encodePath = (path: string): string =>
  path
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/');

const getDefaultBranch = async (
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

const branchExists = async (
  owner: string,
  repo: string,
  branch: string,
  token?: string,
): Promise<boolean> => {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
    repo,
  )}/git/ref/heads/${encodeURIComponent(branch)}`;
  const res = await fetch(url, { headers: buildHeaders(token, false) });
  if (res.status === 404) return false;
  await throwIfNotOk(res);
  return true;
};

const createBranchFrom = async (
  owner: string,
  repo: string,
  newBranch: string,
  fromBranch: string,
  token: string,
): Promise<{ ref: string; sha: string }> => {
  const refUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
    repo,
  )}/git/ref/heads/${encodeURIComponent(fromBranch)}`;
  const refRes = await fetch(refUrl, { headers: buildHeaders(token, true) });
  await throwIfNotOk(refRes);
  const refData = await refRes.json();
  const baseSha: string = refData.object?.sha || refData.sha;

  const createUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
    repo,
  )}/git/refs`;
  const createRes = await fetch(createUrl, {
    method: 'POST',
    headers: { ...buildHeaders(token, true), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha: baseSha }),
  });
  await throwIfNotOk(createRes);
  const createData = await createRes.json();
  return { ref: createData.ref, sha: createData.object?.sha || baseSha };
};

export const githubCommitToDevTool = createTool({
  id: 'github-commit-to-dev',
  description:
    'Ensure dev branch exists (create from default if missing) and create/update a file on it',
  inputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    path: z.string(),
    content: z.string(),
    message: z.string().default('update via agent').optional(),
    devBranch: z.string().default('dev').optional(),
    token: z.string().optional(),
  }),
  outputSchema: z.object({
    branch: z.string(),
    content: z.any(),
    commit: z.any(),
  }),
  execute: async ({ context }) => {
    const { owner, repo, path, content, token: inputToken } = context;
    const message = context.message ?? 'update via agent';
    const devBranch = context.devBranch ?? 'dev';
    const token = resolveToken(inputToken);
    if (!token) throw new Error('Missing GitHub token');

    // Ensure dev branch exists
    const exists = await branchExists(owner, repo, devBranch, token);
    if (!exists) {
      const base = await getDefaultBranch(owner, repo, token);
      await createBranchFrom(owner, repo, devBranch, base, token);
    }

    // Try to read file on dev to get sha (for updates)
    const encodedPath = encodePath(path);
    const params = new URLSearchParams();
    params.set('ref', devBranch);
    const getUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
      repo,
    )}/contents/${encodedPath}?${params.toString()}`;
    let existingSha: string | undefined;
    const getRes = await fetch(getUrl, { headers: buildHeaders(token, false) });
    if (getRes.ok) {
      const data = await getRes.json();
      existingSha = data.sha;
    } else if (getRes.status !== 404) {
      await throwIfNotOk(getRes);
    }

    // Commit file to dev branch
    const putUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
      repo,
    )}/contents/${encodedPath}`;
    const body: Record<string, unknown> = {
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch: devBranch,
    };
    if (existingSha) body.sha = existingSha;

    const putRes = await fetch(putUrl, {
      method: 'PUT',
      headers: { ...buildHeaders(token, true), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    await throwIfNotOk(putRes);
    const putData = await putRes.json();
    return { branch: devBranch, content: putData.content, commit: putData.commit };
  },
});

export const githubOpenDevPrToMainTool = createTool({
  id: 'github-open-dev-pr-to-main',
  description: 'Open a pull request from dev branch to main branch',
  inputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    title: z.string().default('Promote dev to main').optional(),
    body: z.string().optional(),
    headBranch: z.string().default('dev').optional(),
    baseBranch: z.string().default('main').optional(),
    token: z.string().optional(),
  }),
  outputSchema: z.object({
    number: z.number(),
    url: z.string(),
    state: z.string(),
  }),
  execute: async ({ context }) => {
    const { owner, repo, body, token: inputToken } = context;
    const title = context.title ?? 'Promote dev to main';
    const headBranch = context.headBranch ?? 'dev';
    const baseBranch = context.baseBranch ?? 'main';
    const token = resolveToken(inputToken);
    if (!token) throw new Error('Missing GitHub token');

    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
      repo,
    )}/pulls`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...buildHeaders(token, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, head: headBranch, base: baseBranch, body }),
    });
    await throwIfNotOk(res);
    const data = await res.json();
    return { number: data.number, url: data.html_url ?? data.url, state: data.state };
  },
});

export const githubMergePrTool = createTool({
  id: 'github-merge-pr',
  description: 'Merge a pull request by number',
  inputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    pull_number: z.number(),
    merge_method: z.enum(['merge', 'squash', 'rebase']).default('merge').optional(),
    commit_title: z.string().optional(),
    commit_message: z.string().optional(),
    sha: z.string().optional(),
    token: z.string().optional(),
  }),
  outputSchema: z.object({
    merged: z.boolean(),
    sha: z.string().optional(),
    message: z.string().optional(),
  }),
  execute: async ({ context }) => {
    const { owner, repo, pull_number, sha, token: inputToken } = context;
    const merge_method = context.merge_method ?? 'merge';
    const commit_title = context.commit_title;
    const commit_message = context.commit_message;
    const token = resolveToken(inputToken);
    if (!token) throw new Error('Missing GitHub token');

    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
      repo,
    )}/pulls/${pull_number}/merge`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: { ...buildHeaders(token, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ merge_method, commit_title, commit_message, sha }),
    });
    await throwIfNotOk(res);
    const data = await res.json();
    return { merged: !!data.merged, sha: data.sha, message: data.message };
  },
});

export type GithubCommitToDevInput = z.infer<typeof githubCommitToDevTool.inputSchema>;
export type GithubOpenDevPrToMainInput = z.infer<typeof githubOpenDevPrToMainTool.inputSchema>;
export type GithubMergePrInput = z.infer<typeof githubMergePrTool.inputSchema>;


