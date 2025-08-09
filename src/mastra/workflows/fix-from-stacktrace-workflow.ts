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

const parseStackQuick = (
  text: string,
): {
  repoUrl?: string;
  fileCandidates: Array<{ pathOrName: string; line?: number; column?: number }>;
  explicitPath?: string;
  repoFileFromUrl?: { path: string; ref?: string };
  header?: string;
} => {
  const candidates: Array<{ pathOrName: string; line?: number; column?: number }> = [];
  const lines = text.split(/\r?\n/);

  // Try JS frames
  const jsRe = /^\s*at\s+(?:(.*?)\s+\()?(.+?):(\d+):(\d+)\)?$/;
  for (const raw of lines) {
    const m = jsRe.exec(raw);
    if (m) {
      candidates.push({ pathOrName: m[2], line: Number(m[3]), column: Number(m[4]) });
    }
  }

  // Try Python frames: File "...", line N
  const pyRe = /^\s*File\s+"(.+?)",\s+line\s+(\d+)/;
  if (candidates.length === 0) {
    for (const raw of lines) {
      const m = pyRe.exec(raw);
      if (m) {
        candidates.push({ pathOrName: m[1], line: Number(m[2]) });
      }
    }
  }

  // Fallback: generic file:line
  if (candidates.length === 0) {
    const fileLine = /(\S+\.[a-zA-Z0-9]+):(\d+)(?::(\d+))?/;
    for (const raw of lines) {
      const m = fileLine.exec(raw);
      if (m) {
        candidates.push({ pathOrName: m[1], line: Number(m[2]), column: m[3] ? Number(m[3]) : undefined });
      }
    }
  }

  // Extract explicit relative path hint, e.g., "file relative path: README.md"
  let explicitPath: string | undefined;
  {
    const m = /file\s+(?:relative\s+)?path:\s*([^\s,;]+)/i.exec(text);
    if (m) explicitPath = m[1];
  }

  // Repo URL and file path via blob URLs
  const repoUrlMatch = /https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\.git)?(\/blob\/([^\s/]+)\/(\S+))?/i.exec(text);
  let repoUrl: string | undefined;
  let repoFileFromUrl: { path: string; ref?: string } | undefined;
  if (repoUrlMatch) {
    const owner = repoUrlMatch[1];
    const repo = repoUrlMatch[2].replace(/\.git$/i, '');
    repoUrl = `https://github.com/${owner}/${repo}`;
    if (repoUrlMatch[3] && repoUrlMatch[5]) {
      repoFileFromUrl = { path: repoUrlMatch[5], ref: repoUrlMatch[4] };
    }
  }

  const header = lines.find((l) => l.trim().length > 0);
  return { repoUrl, fileCandidates: candidates, explicitPath, repoFileFromUrl, header };
};

const discover = createStep({
  id: 'discover',
  description: 'Parse prompt+stack, resolve repo, identify file and fetch content',
  inputSchema: z.object({
    prompt: z.string().describe('User prompt that includes stack trace and any extra context'),
    owner: z.string().optional(),
    repo: z.string().optional(),
    prTitle: z.string().optional(),
    prBody: z.string().optional(),
    token: z.string().optional(),
  }),
  outputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    candidatePath: z.string(),
    line: z.number().optional(),
    column: z.number().optional(),
    baseBranch: z.string(),
    fileText: z.string(),
    fileSha: z.string(),
    errorHeader: z.string().optional(),
    prompt: z.string(),
    prTitle: z.string().optional(),
    prBody: z.string().optional(),
    token: z.string().optional(),
  }),
  execute: async ({ inputData }) => {
    if (!inputData) throw new Error('Input required');
    const token = resolveToken(inputData.token);

    const parsed = parseStackQuick(inputData.prompt);
    let owner = inputData.owner;
    let repo = inputData.repo;
    if ((!owner || !repo) && parsed.repoUrl) {
      const u = new URL(parsed.repoUrl);
      const parts = u.pathname.split('/').filter(Boolean);
      owner = parts[0];
      repo = parts[1];
    }
    if (!owner || !repo) {
      throw new Error('Owner/repo not provided or detectable from prompt');
    }

    // Get default branch
    const repoUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const repoRes = await fetch(repoUrl, { headers: buildHeaders(token, false) });
    await throwIfNotOk(repoRes);
    const repoData = await repoRes.json();
    let baseBranch = repoData.default_branch as string;
    if (parsed.repoFileFromUrl?.ref) {
      baseBranch = parsed.repoFileFromUrl.ref;
    }

    // Determine candidate path: try first candidate directly; if looks absolute, fallback to search by basename
    // Determine candidate path
    let top = parsed.fileCandidates[0];
    let candidatePath = parsed.explicitPath || parsed.repoFileFromUrl?.path || (top ? top.pathOrName : '');
    if (!candidatePath) {
      throw new Error('No file frames or explicit path found in prompt');
    }
    const isAbsolute = candidatePath.startsWith('/') || /^[A-Za-z]:\\/.test(candidatePath);
    const basename = candidatePath.split(/[\\/]/).pop() || candidatePath;

    let fileApiPath: string | null = null;
    if (!isAbsolute && candidatePath.includes('/')) {
      fileApiPath = candidatePath;
    } else {
      // search by filename in repo using GitHub code search
      const q = `${basename} repo:${owner}/${repo}`;
      const params = new URLSearchParams({ q, per_page: '5', page: '1' });
      const searchUrl = `https://api.github.com/search/code?${params.toString()}`;
      const sRes = await fetch(searchUrl, { headers: buildHeaders(token, false) });
      await throwIfNotOk(sRes);
      const sData = await sRes.json();
      const item = (sData.items || []).find((i: any) => i && i.path && i.name === basename) || (sData.items || [])[0];
      if (!item) throw new Error(`Could not locate ${basename} in ${owner}/${repo}`);
      fileApiPath = item.path as string;
    }

    // Fetch file content (decoded)
    const getParams = new URLSearchParams();
    getParams.set('ref', baseBranch);
    const fileUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodePath(fileApiPath!)}?${getParams.toString()}`;
    const fileRes = await fetch(fileUrl, { headers: buildHeaders(token, false) });
    await throwIfNotOk(fileRes);
    const fileData = await fileRes.json();
    const fileText = Buffer.from(fileData.content, 'base64').toString('utf8');

    return {
      owner,
      repo,
      candidatePath: fileApiPath!,
      line: top?.line,
      column: top?.column,
      baseBranch,
      fileText,
      fileSha: fileData.sha,
      errorHeader: parsed.header,
      prompt: inputData.prompt,
      prTitle: inputData.prTitle,
      prBody: inputData.prBody,
      token: inputData.token,
    };
  },
});

const executeFix = createStep({
  id: 'execute-fix',
  description: 'Generate a minimal fix and commit to a short-lived branch',
  inputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    candidatePath: z.string(),
    baseBranch: z.string(),
    fileText: z.string(),
    line: z.number().optional(),
    column: z.number().optional(),
    fileSha: z.string(),
    errorHeader: z.string().optional(),
    prompt: z.string(),
    prTitle: z.string().optional(),
    prBody: z.string().optional(),
    token: z.string().optional(),
  }),
  outputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    candidatePath: z.string(),
    branch: z.string(),
    commitSha: z.string(),
    newSha: z.string(),
    updatedText: z.string(),
    prTitle: z.string().optional(),
    prBody: z.string().optional(),
    token: z.string().optional(),
  }),
  execute: async ({ inputData }) => {
    if (!inputData) throw new Error('Input required');
    const token = resolveToken(inputData.token);
    const branch = `fix/${Date.now()}`;

    // Placeholder: keep original text (no local LLM call in workflow)
    const updatedText: string = inputData.fileText;

    // Commit updated file to feature branch
    // Ensure branch exists by creating it from base
    const refUrl = `https://api.github.com/repos/${encodeURIComponent(inputData.owner)}/${encodeURIComponent(inputData.repo)}/git/ref/heads/${encodeURIComponent(inputData.baseBranch)}`;
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
    if (!createRes.ok && createRes.status !== 422) { // 422 if already exists
      await throwIfNotOk(createRes);
    }

    const putUrl = `https://api.github.com/repos/${encodeURIComponent(inputData.owner)}/${encodeURIComponent(inputData.repo)}/contents/${encodePath(inputData.candidatePath)}`;
    const putRes = await fetch(putUrl, {
      method: 'PUT',
      headers: { ...buildHeaders(token, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `fix: ${inputData.errorHeader || 'stack-trace fix'}`,
        content: Buffer.from(updatedText, 'utf8').toString('base64'),
        branch,
      }),
    });
    await throwIfNotOk(putRes);
    const putData = await putRes.json();

    return {
      owner: inputData.owner,
      repo: inputData.repo,
      candidatePath: inputData.candidatePath,
      branch,
      commitSha: putData.commit?.sha,
      newSha: putData.content?.sha,
      updatedText,
      prTitle: inputData.prTitle,
      prBody: inputData.prBody,
      token: inputData.token,
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
    candidatePath: z.string(),
    commitSha: z.string(),
    newSha: z.string(),
    updatedText: z.string(),
    prTitle: z.string().optional(),
    prBody: z.string().optional(),
    token: z.string().optional(),
  }),
  outputSchema: z.object({ number: z.number(), url: z.string(), state: z.string() }),
  execute: async ({ inputData }) => {
    if (!inputData) throw new Error('Input required');
    const token = resolveToken(inputData.token);

    // Resolve default branch as base
    const repoUrl = `https://api.github.com/repos/${encodeURIComponent(inputData.owner)}/${encodeURIComponent(inputData.repo)}`;
    const repoRes = await fetch(repoUrl, { headers: buildHeaders(token, false) });
    await throwIfNotOk(repoRes);
    const repoData = await repoRes.json();
    const base = repoData.default_branch as string;

    const title = inputData.prTitle || `fix: automated fix from stack trace`;
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

export const fixFromStacktraceWorkflow = createWorkflow({
  id: 'fix-from-stacktrace',
  inputSchema: discover.inputSchema,
  outputSchema: openPr.outputSchema,
})
  .then(discover)
  .then(executeFix)
  .then(openPr);

fixFromStacktraceWorkflow.commit();


