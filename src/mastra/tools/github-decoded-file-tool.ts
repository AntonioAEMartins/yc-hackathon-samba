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

export const githubDecodedFileTool = createTool({
  id: 'get-github-file-decoded',
  description: 'Get a file via GitHub Contents API and return its decoded UTF-8 content',
  inputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    path: z.string(),
    ref: z.string().optional(),
    token: z.string().optional(),
  }),
  outputSchema: z.object({
    text: z.string(),
    sha: z.string(),
    encoding: z.string(),
    size: z.number(),
  }),
  execute: async ({ context }) => {
    const { owner, repo, path, ref, token: inputToken } = context;
    const token = resolveToken(inputToken);

    const encodedPath = encodePath(path);
    const params = new URLSearchParams();
    if (ref) params.set('ref', ref);

    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}${params.toString() ? `?${params.toString()}` : ''}`;
    const res = await fetch(url, { method: 'GET', headers: buildHeaders(token, false) });
    await throwIfNotOk(res);
    const data = await res.json();
    const base64 = data.content as string;
    const text = Buffer.from(base64, 'base64').toString('utf8');
    return { text, sha: data.sha, encoding: data.encoding, size: data.size };
  },
});

export type GithubDecodedFileInput = z.infer<typeof githubDecodedFileTool.inputSchema>;
export type GithubDecodedFileOutput = z.infer<typeof githubDecodedFileTool.outputSchema>;


