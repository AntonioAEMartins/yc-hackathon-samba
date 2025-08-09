import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { localBuildCheckTool } from '../tools/local-build-check-tool.js';

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

// Steps copied from V2 to allow inserting build check before PR
const parseInput = createStep({
  id: 'parse-input',
  description: 'Parse the user prompt into structured fields',
  inputSchema: z.object({
    prompt: z.string(),
    owner: z.string().optional(),
    repo: z.string().optional(),
    token: z.string().optional(),
    prTitle: z.string().optional(),
    prBody: z.string().optional(),
  }),
  outputSchema: z.object({
    prompt: z.string(),
    owner: z.string().optional(),
    repo: z.string().optional(),
    token: z.string().optional(),
    prTitle: z.string().optional(),
    prBody: z.string().optional(),
    errorHeader: z.string().optional(),
    repoUrl: z.string().optional(),
    repoRef: z.string().optional(),
    explicitPath: z.string().optional(),
    fileCandidates: z.array(z.object({ pathOrName: z.string(), line: z.number().optional(), column: z.number().optional() })),
  }),
  execute: async ({ inputData }) => {
    if (!inputData) throw new Error('Input required');
    const text = inputData.prompt;
    const lines = text.split(/\r?\n/);
    const header = lines.find((l) => l.trim().length > 0);
    const pathMatch = /file\s+(?:relative\s+)?path:\s*([^\s,;]+)/i.exec(text);
    const explicitPath = pathMatch ? pathMatch[1] : undefined;
    const repoUrlMatch = /https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\.git)?(\/blob\/([^\s/]+)\/(\S+))?/i.exec(text);
    let repoUrl: string | undefined;
    let repoRef: string | undefined;
    if (repoUrlMatch) {
      const owner = repoUrlMatch[1];
      const repo = repoUrlMatch[2].replace(/\.git$/i, '');
      repoUrl = `https://github.com/${owner}/${repo}`;
      if (repoUrlMatch[3] && repoUrlMatch[5]) {
        repoRef = repoUrlMatch[4];
      }
    }
    const fileCandidates: Array<{ pathOrName: string; line?: number; column?: number }> = [];
    const jsRe = /^\s*at\s+(?:(.*?)\s+\()?(.+?):(\d+):(\d+)\)?$/;
    for (const raw of lines) {
      const m = jsRe.exec(raw);
      if (m) fileCandidates.push({ pathOrName: m[2], line: Number(m[3]), column: Number(m[4]) });
    }
    if (fileCandidates.length === 0) {
      const pyRe = /^\s*File\s+"(.+?)",\s+line\s+(\d+)/;
      for (const raw of lines) {
        const m = pyRe.exec(raw);
        if (m) fileCandidates.push({ pathOrName: m[1], line: Number(m[2]) });
      }
    }
    return {
      prompt: inputData.prompt,
      owner: inputData.owner,
      repo: inputData.repo,
      token: inputData.token,
      prTitle: inputData.prTitle,
      prBody: inputData.prBody,
      errorHeader: header,
      repoUrl,
      repoRef,
      explicitPath,
      fileCandidates,
    };
  },
});

const resolveRepo = createStep({
  id: 'resolve-repo',
  description: 'Resolve owner/repo and default branch (or ref from blob URL)',
  inputSchema: parseInput.outputSchema,
  outputSchema: z.object({
    prompt: z.string(),
    owner: z.string(),
    repo: z.string(),
    baseBranch: z.string(),
    token: z.string().optional(),
    prTitle: z.string().optional(),
    prBody: z.string().optional(),
    errorHeader: z.string().optional(),
    fileCandidates: z.array(z.object({ pathOrName: z.string(), line: z.number().optional(), column: z.number().optional() })),
    explicitPath: z.string().optional(),
  }),
  execute: async ({ inputData }) => {
    if (!inputData) throw new Error('Input required');
    let owner = inputData.owner;
    let repo = inputData.repo;
    if ((!owner || !repo) && inputData.repoUrl) {
      const u = new URL(inputData.repoUrl);
      const parts = u.pathname.split('/').filter(Boolean);
      owner = parts[0];
      repo = parts[1];
    }
    if (!owner || !repo) throw new Error('Owner/repo missing');
    const token = resolveToken(inputData.token);
    const repoUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const repoRes = await fetch(repoUrl, { headers: buildHeaders(token, false) });
    await throwIfNotOk(repoRes);
    const repoData = await repoRes.json();
    let baseBranch: string = inputData.repoRef || (repoData.default_branch as string);
    return {
      prompt: inputData.prompt,
      owner,
      repo,
      baseBranch,
      token: inputData.token,
      prTitle: inputData.prTitle,
      prBody: inputData.prBody,
      errorHeader: inputData.errorHeader,
      fileCandidates: inputData.fileCandidates,
      explicitPath: inputData.explicitPath,
    };
  },
});

const locateFile = createStep({
  id: 'locate-file',
  description: 'Choose candidate path or search by filename in repo',
  inputSchema: resolveRepo.outputSchema,
  outputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    baseBranch: z.string(),
    candidatePath: z.string(),
    line: z.number().optional(),
    column: z.number().optional(),
    token: z.string().optional(),
    prTitle: z.string().optional(),
    prBody: z.string().optional(),
    errorHeader: z.string().optional(),
    prompt: z.string(),
  }),
  execute: async ({ inputData }) => {
    const token = resolveToken(inputData?.token);
    const top = inputData.fileCandidates[0];
    let candidatePath = inputData.explicitPath || (top ? top.pathOrName : '');
    if (!candidatePath) throw new Error('No file candidates or explicit path');
    // Try direct fetch first
    let foundDirect = false;
    try {
      const params = new URLSearchParams();
      params.set('ref', inputData.baseBranch);
      const testUrl = `https://api.github.com/repos/${encodeURIComponent(inputData.owner)}/${encodeURIComponent(inputData.repo)}/contents/${encodePath(candidatePath)}?${params.toString()}`;
      const testRes = await fetch(testUrl, { headers: buildHeaders(token, false) });
      if (testRes.ok) foundDirect = true;
    } catch {}
    const isAbsolute = candidatePath.startsWith('/') || /^[A-Za-z]:\\/.test(candidatePath);
    if (!foundDirect && (isAbsolute || !candidatePath.includes('/'))) {
      const basename = candidatePath.split(/[\\/]/).pop() || candidatePath;
      const q = `${basename} repo:${inputData.owner}/${inputData.repo}`;
      const params = new URLSearchParams({ q, per_page: '5', page: '1' });
      const searchUrl = `https://api.github.com/search/code?${params.toString()}`;
      const sRes = await fetch(searchUrl, { headers: buildHeaders(token, false) });
      await throwIfNotOk(sRes);
      const sData = await sRes.json();
      const item = (sData.items || []).find((i: any) => i && i.path && i.name === basename) || (sData.items || [])[0];
      if (!item) throw new Error(`Could not locate ${basename} in ${inputData.owner}/${inputData.repo}`);
      candidatePath = item.path as string;
    }
    return {
      owner: inputData.owner,
      repo: inputData.repo,
      baseBranch: inputData.baseBranch,
      candidatePath,
      line: top?.line,
      column: top?.column,
      token: inputData.token,
      prTitle: inputData.prTitle,
      prBody: inputData.prBody,
      errorHeader: inputData.errorHeader,
      prompt: inputData.prompt,
    };
  },
});

const readFile = createStep({
  id: 'read-file',
  description: 'Fetch file content from GitHub',
  inputSchema: locateFile.outputSchema,
  outputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    baseBranch: z.string(),
    candidatePath: z.string(),
    fileText: z.string(),
    fileSha: z.string(),
    token: z.string().optional(),
    prTitle: z.string().optional(),
    prBody: z.string().optional(),
    errorHeader: z.string().optional(),
    prompt: z.string(),
  }),
  execute: async ({ inputData }) => {
    const token = resolveToken(inputData?.token);
    const params = new URLSearchParams();
    params.set('ref', inputData.baseBranch);
    const fileUrl = `https://api.github.com/repos/${encodeURIComponent(inputData.owner)}/${encodeURIComponent(inputData.repo)}/contents/${encodePath(inputData.candidatePath)}?${params.toString()}`;
    const res = await fetch(fileUrl, { headers: buildHeaders(token, false) });
    await throwIfNotOk(res);
    const data = await res.json();
    const text = Buffer.from(data.content, 'base64').toString('utf8');
    return {
      owner: inputData.owner,
      repo: inputData.repo,
      baseBranch: inputData.baseBranch,
      candidatePath: inputData.candidatePath,
      fileText: text,
      fileSha: data.sha,
      token: inputData.token,
      prTitle: inputData.prTitle,
      prBody: inputData.prBody,
      errorHeader: inputData.errorHeader,
      prompt: inputData.prompt,
    };
  },
});

const proposeFix = createStep({
  id: 'propose-fix',
  description: 'Derive an updated file content (placeholder: no-op)',
  inputSchema: readFile.outputSchema,
  outputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    baseBranch: z.string(),
    candidatePath: z.string(),
    fileSha: z.string(),
    updatedText: z.string(),
    token: z.string().optional(),
    prTitle: z.string().optional(),
    prBody: z.string().optional(),
  }),
  execute: async ({ inputData }) => {
    return {
      owner: inputData.owner,
      repo: inputData.repo,
      baseBranch: inputData.baseBranch,
      candidatePath: inputData.candidatePath,
      fileSha: inputData.fileSha,
      updatedText: inputData.fileText,
      token: inputData.token,
      prTitle: inputData.prTitle,
      prBody: inputData.prBody,
    };
  },
});

const commitFix = createStep({
  id: 'commit-fix',
  description: 'Create feature branch and commit updated file',
  inputSchema: proposeFix.outputSchema,
  outputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    branch: z.string(),
    candidatePath: z.string(),
    commitSha: z.string(),
    newSha: z.string(),
    token: z.string().optional(),
    prTitle: z.string().optional(),
    prBody: z.string().optional(),
  }),
  execute: async ({ inputData }) => {
    const token = resolveToken(inputData?.token);
    const branch = `fix/${Date.now()}`;
    const refUrl = `https://api.github.com/repos/${encodeURIComponent(inputData.owner)}/${encodeURIComponent(inputData.repo)}/git/ref/heads/${encodeURIComponent('main')}`;
    const refRes = await fetch(refUrl, { headers: buildHeaders(token, true) });
    await throwIfNotOk(refRes);
    const refData = await refRes.json();
    const baseSha: string = refData.object?.sha || refData.sha;
    const createRefUrl = `https://api.github.com/repos/${encodeURIComponent(inputData.owner)}/${encodeURIComponent(inputData.repo)}/git/refs`;
    const createRes = await fetch(createRefUrl, {
      method: 'POST',
      headers: { ...buildHeaders(token, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
    });
    if (!createRes.ok && createRes.status !== 422) {
      await throwIfNotOk(createRes);
    }
    const putUrl = `https://api.github.com/repos/${encodeURIComponent(inputData.owner)}/${encodeURIComponent(inputData.repo)}/contents/${encodePath(inputData.candidatePath)}`;
    const putRes = await fetch(putUrl, {
      method: 'PUT',
      headers: { ...buildHeaders(token, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'fix: automated stack-trace fix',
        content: Buffer.from(inputData.updatedText, 'utf8').toString('base64'),
        sha: inputData.fileSha,
        branch,
      }),
    });
    await throwIfNotOk(putRes);
    const putData = await putRes.json();
    return {
      owner: inputData.owner,
      repo: inputData.repo,
      branch,
      candidatePath: inputData.candidatePath,
      commitSha: putData.commit?.sha,
      newSha: putData.content?.sha,
      token: inputData.token,
      prTitle: inputData.prTitle,
      prBody: inputData.prBody,
    };
  },
});

const runBuildCheck = createStep({
  id: 'run-build-check',
  description: 'Download repo at branch, install deps and build to verify compilation',
  inputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    branch: z.string(),
    token: z.string().optional(),
    prTitle: z.string().optional(),
    prBody: z.string().optional(),
  }),
  outputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    branch: z.string(),
    ok: z.boolean(),
    logs: z.string(),
    packageManager: z.string().optional(),
    buildCommand: z.string().optional(),
    token: z.string().optional(),
    prTitle: z.string().optional(),
    prBody: z.string().optional(),
  }),
  execute: async ({ inputData }) => {
    const res = await localBuildCheckTool.execute({
      context: {
        owner: inputData.owner,
        repo: inputData.repo,
        ref: inputData.branch,
        token: inputData.token,
      },
    } as any);
    return {
      owner: inputData.owner,
      repo: inputData.repo,
      branch: inputData.branch,
      ok: !!res.ok,
      logs: String(res.logs || ''),
      packageManager: (res as any).packageManager,
      buildCommand: (res as any).buildCommand,
      token: inputData.token,
      prTitle: inputData.prTitle,
      prBody: inputData.prBody,
    };
  },
});

const openPr = createStep({
  id: 'open-pr',
  description: 'Open a PR from the fix branch to default',
  inputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    branch: z.string(),
    token: z.string().optional(),
    prTitle: z.string().optional(),
    prBody: z.string().optional(),
  }),
  outputSchema: z.object({ number: z.number(), url: z.string(), state: z.string() }),
  execute: async ({ inputData }) => {
    const token = resolveToken(inputData.token);
    const repoUrl = `https://api.github.com/repos/${encodeURIComponent(inputData.owner)}/${encodeURIComponent(inputData.repo)}`;
    const repoRes = await fetch(repoUrl, { headers: buildHeaders(token, false) });
    await throwIfNotOk(repoRes);
    const repoData = await repoRes.json();
    const base = repoData.default_branch as string;
    const title = inputData.prTitle || 'fix: automated fix from stack trace';
    const body = inputData.prBody || 'Automated fix generated by workflow.';
    const prsUrl = `https://api.github.com/repos/${encodeURIComponent(inputData.owner)}/${encodeURIComponent(inputData.repo)}/pulls`;
    const res = await fetch(prsUrl, {
      method: 'POST',
      headers: { ...buildHeaders(token, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, head: inputData.branch, base, body }),
    });
    await throwIfNotOk(res);
    const data = await res.json();
    return { number: data.number, url: data.html_url ?? data.url, state: data.state };
  },
});

export const fixFromStacktraceWorkflowV3 = createWorkflow({
  id: 'fix-from-stacktrace-v3',
  inputSchema: parseInput.inputSchema,
  outputSchema: openPr.outputSchema,
})
  .then(parseInput)
  .then(resolveRepo)
  .then(locateFile)
  .then(readFile)
  .then(proposeFix)
  .then(commitFix)
  .then(runBuildCheck)
  .then(openPr);

fixFromStacktraceWorkflowV3.commit();


