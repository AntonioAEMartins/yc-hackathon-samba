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

// Note: GitHub code search requires indexing; newly pushed code may take time to appear in results.
export const githubSearchCodeTool = createTool({
  id: 'github-search-code',
  description: 'Search code within a single repo using GitHub code search',
  inputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    query: z.string(),
    per_page: z.number().min(1).max(100).default(30).optional(),
    page: z.number().min(1).default(1).optional(),
    token: z.string().optional(),
  }),
  outputSchema: z.object({
    items: z.array(z.any()),
    total_count: z.number(),
  }),
  execute: async ({ context }) => {
    const { owner, repo, query, token: inputToken } = context;
    const per_page = context.per_page ?? 30;
    const page = context.page ?? 1;
    const token = resolveToken(inputToken);

    const q = `${query} repo:${owner}/${repo}`;
    const params = new URLSearchParams({ q, per_page: String(per_page), page: String(page) });
    const url = `https://api.github.com/search/code?${params.toString()}`;
    const res = await fetch(url, { headers: buildHeaders(token, false) });
    await throwIfNotOk(res);
    const data = await res.json();
    return { items: data.items ?? [], total_count: data.total_count ?? 0 };
  },
});

export type GithubSearchCodeInput = z.infer<typeof githubSearchCodeTool.inputSchema>;
export type GithubSearchCodeOutput = z.infer<typeof githubSearchCodeTool.outputSchema>;


