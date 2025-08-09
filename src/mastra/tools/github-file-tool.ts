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

export const githubFileTool = createTool({
  id: 'get-github-file',
  description: 'Get the contents metadata for a file via GitHub Contents API',
  inputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    path: z.string(),
    ref: z.string().optional(),
    token: z.string().optional(),
  }),
  outputSchema: z.object({
    content: z.string(),
    encoding: z.string(),
    sha: z.string(),
    size: z.number(),
  }),
  execute: async ({ context }) => {
    const { owner, repo, path, ref, token: inputToken } = context;
    const token = resolveToken(inputToken);

    const encodedPath = encodePath(path);
    const params = new URLSearchParams();
    if (ref) params.set('ref', ref);

    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}${params.toString() ? `?${params.toString()}` : ''}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: buildHeaders(token, false),
    });

    await throwIfNotOk(res);
    const data = await res.json();
    // Return JSON as-is; "content" remains base64-encoded per API contract
    return {
      content: data.content,
      encoding: data.encoding,
      sha: data.sha,
      size: data.size,
    };
  },
});

export type GithubFileToolInput = z.infer<typeof githubFileTool.inputSchema>;
export type GithubFileToolOutput = z.infer<typeof githubFileTool.outputSchema>;


