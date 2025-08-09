import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

const listReposStep = createStep({
  id: 'list-repos',
  description: 'List repositories for a given user (first page)',
  inputSchema: z.object({
    user: z.string().describe('GitHub username'),
    per_page: z.number().min(1).max(100).default(30).optional(),
    page: z.number().min(1).default(1).optional(),
    token: z.string().optional(),
  }),
  outputSchema: z.object({
    repositories: z.array(z.any()),
    total: z.number(),
  }),
  execute: async ({ inputData, mastra }) => {
    if (!inputData) throw new Error('Input required');
    const agent = mastra?.getAgent('githubAgent');
    if (!agent) throw new Error('GitHub agent not found');

    const result = await agent.tool('github-list-repos', {
      user: inputData.user,
      per_page: inputData.per_page ?? 30,
      page: inputData.page ?? 1,
      token: inputData.token,
    });

    return result as { repositories: any[]; total: number };
  },
});

const readFileStep = createStep({
  id: 'read-file',
  description: 'Read file contents metadata from a repository',
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
  execute: async ({ inputData, mastra }) => {
    if (!inputData) throw new Error('Input required');
    const agent = mastra?.getAgent('githubAgent');
    if (!agent) throw new Error('GitHub agent not found');

    try {
      const result = await agent.tool('get-github-file', {
        owner: inputData.owner,
        repo: inputData.repo,
        path: inputData.path,
        ref: inputData.ref,
        token: inputData.token,
      });
      return result as { content: string; encoding: string; sha: string; size: number };
    } catch (err: any) {
      const message = String(err?.message || err);
      // Clarify common 404 causes
      if (message.includes('404')) {
        throw new Error(
          `${message} — Check that the owner/repo exist, the path is correct for the specified ref, and that you have access (private repo requires a token).`,
        );
      }
      throw err;
    }
  },
});

export const githubWorkflow = createWorkflow({
  id: 'github-workflow',
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
})
  .then(listReposStep, ({ inputData }) => ({
    user: inputData.listUser,
    token: inputData.token,
  }))
  .then(readFileStep, ({ inputData }) => ({
    owner: inputData.fileOwner,
    repo: inputData.fileRepo,
    path: inputData.filePath,
    ref: inputData.fileRef,
    token: inputData.token,
  }))
  .map(({ outputs }) => ({
    repositories: outputs[0].repositories,
    total: outputs[0].total,
    file: outputs[1],
  }));

githubWorkflow.commit();

export { githubWorkflow };


