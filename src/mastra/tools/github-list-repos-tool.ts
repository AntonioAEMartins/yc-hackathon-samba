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

export const githubListReposTool = createTool({
  id: 'github-list-repos',
  description: 'List repositories for a user, an org, or the authenticated user',
  inputSchema: z.object({
    user: z.string().optional(),
    org: z.string().optional(),
    visibility: z.enum(['all', 'public', 'private']).default('all').optional(),
    per_page: z.number().min(1).max(100).default(30).optional(),
    page: z.number().min(1).default(1).optional(),
    token: z.string().optional(),
  }),
  outputSchema: z.object({
    repositories: z.array(z.any()),
    total: z.number(),
  }),
  execute: async ({ context }) => {
    const { user, org, token: inputToken } = context;
    const visibility = context.visibility ?? 'all';
    const per_page = context.per_page ?? 30;
    const page = context.page ?? 1;

    const token = resolveToken(inputToken);

    const params = new URLSearchParams();
    params.set('per_page', String(per_page));
    params.set('page', String(page));

    let url: string;
    if (org) {
      // For orgs, GitHub uses 'type' to filter
      params.set('type', visibility);
      url = `https://api.github.com/orgs/${encodeURIComponent(org)}/repos?${params.toString()}`;
    } else if (user) {
      // For users, GitHub uses 'type' to filter
      params.set('type', visibility);
      url = `https://api.github.com/users/${encodeURIComponent(user)}/repos?${params.toString()}`;
    } else {
      // Authenticated user
      params.set('visibility', visibility);
      url = `https://api.github.com/user/repos?${params.toString()}`;
    }

    const res = await fetch(url, { headers: buildHeaders(token, !!(!user && !org)) });
    await throwIfNotOk(res);

    const data = await res.json();
    const repositories = Array.isArray(data) ? data : [];

    // GitHub does not give total in body; we can approximate by length of current page
    return { repositories, total: repositories.length };
  },
});

export type GithubListReposInput = z.infer<typeof githubListReposTool.inputSchema>;
export type GithubListReposOutput = z.infer<typeof githubListReposTool.outputSchema>;


