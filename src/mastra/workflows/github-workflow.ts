import { createStep, createWorkflow } from '@mastra/core/workflows';
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

const runGithubOps = createStep({
  id: 'run-github-ops',
  description: 'List repos for a user and read a file from a repo',
  inputSchema: z.object({
    listUser: z.string().describe('GitHub username to list repos for'),
    fileOwner: z.string(),
    fileRepo: z.string(),
    filePath: z.string(),
    fileRef: z.string().optional(),
    token: z.string().optional(),
  }),
  outputSchema: z.object({
    repositories: z.array(z.any()),
    total: z.number(),
    file: z.object({
      content: z.string(),
      encoding: z.string(),
      sha: z.string(),
      size: z.number(),
    }),
  }),
  execute: async ({ inputData }) => {
    if (!inputData) throw new Error('Input required');
    const token = resolveToken(inputData.token);

    const listParams = new URLSearchParams();
    listParams.set('per_page', '30');
    listParams.set('page', '1');
    listParams.set('type', 'all');
    const listUrl = `https://api.github.com/users/${encodeURIComponent(inputData.listUser)}/repos?${listParams.toString()}`;
    const listRes = await fetch(listUrl, { headers: buildHeaders(token, false) });
    await throwIfNotOk(listRes);
    const repositories = (await listRes.json()) as any[];

    const fileParams = new URLSearchParams();
    if (inputData.fileRef) fileParams.set('ref', inputData.fileRef);
    const fileUrl = `https://api.github.com/repos/${encodeURIComponent(inputData.fileOwner)}/${encodeURIComponent(
      inputData.fileRepo,
    )}/contents/${encodePath(inputData.filePath)}${fileParams.toString() ? `?${fileParams.toString()}` : ''}`;
    const fileRes = await fetch(fileUrl, { headers: buildHeaders(token, false) });
    try {
      await throwIfNotOk(fileRes);
    } catch (err: any) {
      const message = String(err?.message || err);
      if (message.includes('404')) {
        throw new Error(
          `${message} — Check that the owner/repo exist, the path is correct for the specified ref, and that you have access (private repo requires a token).`,
        );
      }
      throw err;
    }
    const fileData = await fileRes.json();

    return {
      repositories,
      total: repositories.length,
      file: {
        content: fileData.content,
        encoding: fileData.encoding,
        sha: fileData.sha,
        size: fileData.size,
      },
    };
  },
});

const githubWorkflow = createWorkflow({
  id: 'github-workflow',
  inputSchema: runGithubOps.inputSchema,
  outputSchema: runGithubOps.outputSchema,
}).then(runGithubOps);

githubWorkflow.commit();

export { githubWorkflow };


