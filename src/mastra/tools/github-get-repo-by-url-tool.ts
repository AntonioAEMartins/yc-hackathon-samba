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

const parseGithubUrl = (inputUrl: string): { owner: string; repo: string } => {
  const trimmed = inputUrl.trim();

  // Handle common SSH forms by normalizing to https
  let normalized = trimmed
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/^ssh:\/\/git@github\.com\//, 'https://github.com/');

  // Prefix scheme if missing
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `https://${normalized}`;
  }

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error(`Invalid URL: ${inputUrl}`);
  }

  if (!url.hostname.endsWith('github.com')) {
    throw new Error('URL must point to github.com');
  }

  const parts = url.pathname
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (parts.length < 2) {
    throw new Error('URL must include both owner and repo, e.g. https://github.com/owner/repo');
  }

  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, '');

  if (!owner || !repo) {
    throw new Error('Could not parse owner and repo from URL');
  }

  return { owner, repo };
};

export const githubGetRepoByUrlTool = createTool({
  id: 'github-get-repo-by-url',
  description: 'Retrieve repository metadata using a GitHub URL (owner/repo)',
  inputSchema: z.object({
    url: z.string().describe('GitHub repository URL, e.g., https://github.com/owner/repo'),
    token: z.string().optional(),
  }),
  outputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    repository: z.any(),
  }),
  execute: async ({ context }) => {
    const { url: inputUrl, token: inputToken } = context;
    const token = resolveToken(inputToken);

    const { owner, repo } = parseGithubUrl(inputUrl);
    const apiUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

    const res = await fetch(apiUrl, { headers: buildHeaders(token, false) });
    await throwIfNotOk(res);
    const repository = await res.json();

    return { owner, repo, repository };
  },
});

export type GithubGetRepoByUrlInput = z.infer<typeof githubGetRepoByUrlTool.inputSchema>;
export type GithubGetRepoByUrlOutput = z.infer<typeof githubGetRepoByUrlTool.outputSchema>;


