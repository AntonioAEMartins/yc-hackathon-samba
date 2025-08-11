import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { proposeFixGpt5Tool } from '../tools/propose-fix-gpt5-tool.js';
import { initFreestyleSandbox } from '../freestyle_init.js';

const resolveToken = (inputToken?: string): string | undefined => {
  return (
    inputToken ||
    process.env.GITHUB_MCP_PAT ||
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

// Simple run id generator for correlating logs across steps
const generateRunId = (): string => `${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}`;

// Step 0: Prepare input. In dev, synthesize a fake Sentry prompt when none is provided
const prepareInput = createStep({
  id: 'prepare-input',
  description: 'Prepare workflow input. In dev, generate a fake Sentry stack/prompt when none provided.',
  inputSchema: z.object({
    prompt: z.string().optional(),
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
  }),
  execute: async ({ inputData }) => {
    const env = (process.env.ENVIRONMENT || '').toLowerCase();
    const hasPrompt = !!inputData?.prompt && inputData.prompt.trim().length > 0;
    if (env === 'dev' && !hasPrompt) {
      // Defaults for the demo repo and file provided by the user
      const owner = inputData?.owner || 'AntonioAEMartins';
      const repo = inputData?.repo || 'yc-hackathon-social';
      const filePath = 'src/server/friends.routes.ts';
      const repoUrl = `https://github.com/${owner}/${repo}/blob/main/${filePath}`;
      const prTitle = inputData?.prTitle || 'Automated fix from Sentry alert (dev)';

      // Minimal synthetic stack referencing the problematic file
      const stackLines: string[] = [
        'Error: Intentional test error in src/server/friends.routes.ts',
        '    at POST /friends (src/server/friends.routes.ts:100:10)',
        '    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)',
      ];
      const sections: string[] = [];
      sections.push('Stack trace:');
      sections.push(stackLines.join('\n'));
      sections.push('\nRepo URL:');
      sections.push(repoUrl);
      sections.push('\nFile relative path:');
      sections.push(filePath);
      const prompt = sections.join('\n');

      try { console.log('[v2/prepare-input] dev synthetic prompt generated'); } catch {}
      return {
        prompt: String(prompt),
        owner,
        repo,
        token: inputData?.token,
        prTitle,
        prBody: inputData?.prBody,
      };
    }

    if (!inputData || !hasPrompt) {
      throw new Error('Input prompt required');
    }
    return {
      prompt: String(inputData.prompt),
      owner: inputData.owner,
      repo: inputData.repo,
      token: inputData.token,
      prTitle: inputData.prTitle,
      prBody: inputData.prBody,
    };
  },
});

// Step 1: Parse input prompt for repo URL, explicit file path, and stack frames
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
    runId: z.string(),
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
    const runId = generateRunId();
    try { console.log('[v2/parse-input] in', { runId, promptSize: inputData.prompt.length }); } catch {}
    const text = inputData.prompt;
    const lines = text.split(/\r?\n/);
    const header = lines.find((l) => l.trim().length > 0);

    // Extract explicit relative path label
    const pathMatch = /file\s+(?:relative\s+)?path:\s*([^\s,;]+)/i.exec(text);
    const explicitPath = pathMatch ? pathMatch[1] : undefined;

    // Extract repo URL and optional blob ref/path
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

    // Extract frames: JS and Python basic. Also normalize framework compiled paths back to src/* when possible.
    const fileCandidates: Array<{ pathOrName: string; line?: number; column?: number }> = [];
    const jsRe = /^\s*at\s+(?:(.*?)\s+\()?(.+?):(\d+):(\d+)\)?$/;
    for (const raw of lines) {
      const m = jsRe.exec(raw);
      if (m) {
        let pathOrName = m[2];
        // Heuristic: if path looks like Next.js compiled output, try to pull the original src path from the stack line context
        if (/\.next\//.test(pathOrName) && /route\.js$/.test(pathOrName)) {
          // Look at the entire raw line; sometimes the original TS/TSX path is logged in the message/crumbs separately
          const srcMatch = /(src\/[A-Za-z0-9_.\-\/]+\.(?:ts|tsx|js|jsx))/i.exec(raw);
          if (srcMatch) pathOrName = srcMatch[1];
        }
        fileCandidates.push({ pathOrName, line: Number(m[3]), column: Number(m[4]) });
      }
    }
    if (fileCandidates.length === 0) {
      const pyRe = /^\s*File\s+"(.+?)",\s+line\s+(\d+)/;
      for (const raw of lines) {
        const m = pyRe.exec(raw);
        if (m) fileCandidates.push({ pathOrName: m[1], line: Number(m[2]) });
      }
    }

    // Prefer repo-relative paths like src/...ext if present anywhere in the prompt.
    // This helps avoid selecting compiled paths like /.next/server/.../route.js from frameworks.
    try {
      const genericPathRe = /(src\/[A-Za-z0-9_.\-\/]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|rb|go|java|cs|php|md))/i;
      let repoRelPath: string | undefined;
      for (const raw of lines) {
        const m = genericPathRe.exec(raw);
        if (m) { repoRelPath = m[1]; break; }
      }
      if (!repoRelPath) {
        // Try whole text once more if line scanning missed it
        const mAll = genericPathRe.exec(text);
        if (mAll) repoRelPath = mAll[1];
      }
      if (repoRelPath) {
        const already = fileCandidates.find((c) => String(c.pathOrName || '').includes(repoRelPath!));
        if (!already) {
          // Put at the front to be the primary candidate
          fileCandidates.unshift({ pathOrName: repoRelPath });
        }
      }
    } catch {}

    const out = {
      runId,
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
    try { console.log('[v2/parse-input] out', { runId, hasRepoUrl: !!repoUrl, explicitPath, candidates: fileCandidates.length }); } catch {}
    return out;
  },
});

// Step 2: Resolve owner/repo and base branch
const resolveRepo = createStep({
  id: 'resolve-repo',
  description: 'Resolve owner/repo and default branch (or ref from blob URL)',
  inputSchema: parseInput.outputSchema,
  outputSchema: z.object({
    runId: z.string(),
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
    try { console.log('[v2/resolve-repo] in', { runId: inputData.runId, owner: !!inputData.owner, repo: !!inputData.repo, repoUrl: inputData.repoUrl }); } catch {}
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

    const out = {
      runId: inputData.runId,
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
    try { console.log('[v2/resolve-repo] out', { runId: inputData.runId, owner, repo, baseBranch }); } catch {}
    return out;
  },
});

// Step 3: Locate file path
const locateFile = createStep({
  id: 'locate-file',
  description: 'Choose candidate path or search by filename in repo',
  inputSchema: resolveRepo.outputSchema,
  outputSchema: z.object({
    runId: z.string(),
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
    try { console.log('[v2/locate-file] in', { runId: inputData.runId, explicitPath: inputData.explicitPath, candidates: inputData.fileCandidates.length }); } catch {}
    const top = inputData.fileCandidates[0];
    let candidatePath = inputData.explicitPath || (top ? top.pathOrName : '');
    if (!candidatePath) throw new Error('No file candidates or explicit path');

    // First, try direct fetch of the candidate path at the repo root (common for README.md)
    let foundDirect = false;
    try {
      const params = new URLSearchParams();
      params.set('ref', inputData.baseBranch);
      const testUrl = `https://api.github.com/repos/${encodeURIComponent(inputData.owner)}/${encodeURIComponent(inputData.repo)}/contents/${encodePath(candidatePath)}?${params.toString()}`;
      const testRes = await fetch(testUrl, { headers: buildHeaders(token, false) });
      if (testRes.ok) {
        foundDirect = true;
      }
    } catch {
      // ignore and fall back to search
    }

    // If not directly found, fall back to GitHub code search by basename.
    // This runs regardless of whether the candidate has slashes, because the
    // original path may be compiled output (e.g., .next/server/.../route.js).
    if (!foundDirect) {
      const basenameRaw = candidatePath.split(/[\\/]/).pop() || candidatePath;
      const altBasenames: string[] = [basenameRaw];
      // Try TypeScript variants when we see compiled .js
      if (/\.jsx?$/.test(basenameRaw)) {
        altBasenames.push(basenameRaw.replace(/\.jsx?$/, '.ts'));
        altBasenames.push(basenameRaw.replace(/\.jsx?$/, '.tsx'));
      }
      let pickedPath: string | undefined;
      let pickedName: string | undefined;
      for (const name of altBasenames) {
        const q = `${name} repo:${inputData.owner}/${inputData.repo}`;
        const params = new URLSearchParams({ q, per_page: '10', page: '1' });
        const searchUrl = `https://api.github.com/search/code?${params.toString()}`;
        const sRes = await fetch(searchUrl, { headers: buildHeaders(token, false) });
        await throwIfNotOk(sRes);
        const sData = await sRes.json();
        const item = (sData.items || []).find((i: any) => i && i.path && i.name === name) || (sData.items || [])[0];
        if (item && item.path) {
          pickedPath = item.path as string;
          pickedName = item.name as string;
          break;
        }
      }
      if (!pickedPath) {
        throw new Error(`Could not locate ${basenameRaw} in ${inputData.owner}/${inputData.repo}`);
      }
      candidatePath = pickedPath;
      try { console.log('[v2/locate-file] fallback_search', { basename: basenameRaw, pickedName, candidatePath }); } catch {}
    }
    const out = {
      runId: inputData.runId,
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
    try { console.log('[v2/locate-file] out', { runId: inputData.runId, candidatePath }); } catch {}
    return out;
  },
});

// Step 4: Read file content (decoded)
const readFile = createStep({
  id: 'read-file',
  description: 'Fetch file content from GitHub',
  inputSchema: locateFile.outputSchema,
  outputSchema: z.object({
    runId: z.string(),
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
    try { console.log('[v2/read-file] in', { runId: inputData.runId, candidatePath: inputData.candidatePath, baseBranch: inputData.baseBranch }); } catch {}
    const params = new URLSearchParams();
    params.set('ref', inputData.baseBranch);
    const fileUrl = `https://api.github.com/repos/${encodeURIComponent(inputData.owner)}/${encodeURIComponent(inputData.repo)}/contents/${encodePath(inputData.candidatePath)}?${params.toString()}`;
    const res = await fetch(fileUrl, { headers: buildHeaders(token, false) });
    await throwIfNotOk(res);
    const data = await res.json();
    const text = Buffer.from(data.content, 'base64').toString('utf8');
    const out = {
      runId: inputData.runId,
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
    try { console.log('[v2/read-file] out', { runId: inputData.runId, hasText: !!text, sha: data.sha }); } catch {}
    return out;
  },
});

// Step 5: Propose fix using GPT-5 tool with full context (file path, content, stack, line)
const proposeFix = createStep({
  id: 'propose-fix',
  description: 'Derive an updated file content via GPT-5',
  inputSchema: readFile.outputSchema,
  outputSchema: z.object({
    runId: z.string(),
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
    try { console.log('[v2/propose-fix] in', { runId: inputData.runId }); } catch {}

    let updated = inputData.fileText;
    try {
      const toolRes = await proposeFixGpt5Tool.execute({
        context: {
          filePath: inputData.candidatePath,
          fileText: inputData.fileText,
          stack: inputData.prompt, // parse-input already embeds stack in prompt
          errorHeader: inputData.errorHeader,
          language: (/(\.ts|\.tsx)$/i.test(inputData.candidatePath)) ? 'TypeScript' : undefined,
          line: (inputData as any).line,
          column: (inputData as any).column,
          prompt: inputData.prompt,
        },
      } as any);
      if (toolRes?.updatedText && typeof toolRes.updatedText === 'string') {
        updated = toolRes.updatedText;
      }
    } catch (err) {
      try { console.error('[v2/propose-fix] gpt5_error', { runId: inputData.runId, err: String(err) }); } catch {}
    }

    const out = {
      runId: inputData.runId,
      owner: inputData.owner,
      repo: inputData.repo,
      baseBranch: inputData.baseBranch,
      candidatePath: inputData.candidatePath,
      fileSha: inputData.fileSha,
      updatedText: updated,
      token: inputData.token,
      prTitle: inputData.prTitle,
      prBody: inputData.prBody,
    };
    try { console.log('[v2/propose-fix] out', { runId: inputData.runId, changed: updated !== inputData.fileText }); } catch {}
    return out;
  },
});

// Step 6: Commit fix on a feature branch
const commitFix = createStep({
  id: 'commit-fix',
  description: 'Create feature branch and commit updated file',
  inputSchema: proposeFix.outputSchema,
  outputSchema: z.object({
    runId: z.string(),
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
    try { console.log('[v2/commit-fix] in', { runId: inputData.runId, candidatePath: inputData.candidatePath, baseBranch: inputData.baseBranch }); } catch {}

    // If no change, abort early to avoid empty commit
    try {
      const original = inputData.fileSha; // presence of sha indicates we fetched an existing file
      const updatedText = inputData.updatedText ?? '';
      if ((updatedText || '').length === 0) {
        console.warn('[v2/commit-fix] empty updatedText, skipping commit', { runId: inputData.runId });
        return {
          runId: inputData.runId,
          owner: inputData.owner,
          repo: inputData.repo,
          branch: inputData.baseBranch,
          candidatePath: inputData.candidatePath,
          commitSha: '',
          newSha: original || '',
          token: inputData.token,
          prTitle: inputData.prTitle,
          prBody: inputData.prBody,
        };
      }
    } catch {}
    const branch = `fix/${Date.now()}`;

    // Create branch from default
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

    const out = {
      runId: inputData.runId,
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
    try { console.log('[v2/commit-fix] out', { runId: inputData.runId, branch, commitSha: putData.commit?.sha }); } catch {}
    return out;
  },
});

// Step 7: Open PR (to dev if it exists; fallback to default branch)
const openPr = createStep({
  id: 'open-pr',
  description: 'Open a PR to default branch',
  inputSchema: commitFix.outputSchema,
  outputSchema: z.object({
    runId: z.string(),
    owner: z.string(),
    repo: z.string(),
    branch: z.string(),
    token: z.string().optional(),
    number: z.number(),
    url: z.string(),
    state: z.string(),
  }),
  execute: async ({ inputData }) => {
    const token = resolveToken(inputData?.token);
    try { console.log('[v2/open-pr] in', { runId: inputData.runId, branch: inputData.branch, owner: inputData.owner, repo: inputData.repo }); } catch {}
    const repoUrl = `https://api.github.com/repos/${encodeURIComponent(inputData.owner)}/${encodeURIComponent(inputData.repo)}`;
    const repoRes = await fetch(repoUrl, { headers: buildHeaders(token, false) });
    await throwIfNotOk(repoRes);
    const repoData = await repoRes.json();

    // Determine source base branch to branch off from (prefer dev when it exists)
    let sourceBase: string = (repoData.default_branch as string) || 'main';
    try {
      const devUrl = `${repoUrl}/branches/dev`;
      const devRes = await fetch(devUrl, { headers: buildHeaders(token, false) });
      if (devRes.ok) sourceBase = 'dev';
    } catch {}

    // Derive a timestamp from the fix branch (fix/<timestamp>), fallback to now
    let ts = String(Date.now());
    try {
      const m = /^fix\/(\d+)/.exec(inputData.branch || '');
      if (m && m[1]) ts = m[1];
    } catch {}
    const newBaseBranch = `dev-${ts}`;

    // Create the new base branch refs/heads/dev-<timestamp> from sourceBase
    try {
      const refUrl = `${repoUrl}/git/ref/heads/${encodeURIComponent(sourceBase)}`;
      const refRes = await fetch(refUrl, { headers: buildHeaders(token, true) });
      await throwIfNotOk(refRes);
      const refData = await refRes.json();
      const baseSha: string = refData.object?.sha || refData.sha;

      const createRefUrl = `${repoUrl}/git/refs`;
      const createRes = await fetch(createRefUrl, {
        method: 'POST',
        headers: { ...buildHeaders(token, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: `refs/heads/${newBaseBranch}`, sha: baseSha }),
      });
      if (!createRes.ok && createRes.status !== 422) {
        await throwIfNotOk(createRes);
      }
    } catch (err) {
      try { console.error('[v2/open-pr] create_base_branch_error', { err: String(err) }); } catch {}
      throw err;
    }

    const title = inputData.prTitle || 'fix: automated fix from stack trace';
    const body = inputData.prBody || 'Automated fix generated by workflow.';

    const prsUrl = `${repoUrl}/pulls`;
    const res = await fetch(prsUrl, {
      method: 'POST',
      headers: { ...buildHeaders(token, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, head: inputData.branch, base: newBaseBranch, body }),
    });
    await throwIfNotOk(res);
    const data = await res.json();
    const out = {
      runId: inputData.runId,
      owner: inputData.owner,
      repo: inputData.repo,
      branch: inputData.branch,
      token: inputData.token,
      number: data.number,
      url: data.html_url ?? data.url,
      state: data.state,
    };
    try { console.log('[v2/open-pr] out', out); } catch {}
    return out;
  },
});

// Step 8: Merge PR automatically (attempt approve then merge)
const mergePr = createStep({
  id: 'merge-pr',
  description: 'Automatically approve (best-effort) and merge the PR',
  inputSchema: openPr.outputSchema,
  outputSchema: z.object({
    number: z.number(),
    url: z.string(),
    merged: z.boolean(),
    sha: z.string().optional(),
    message: z.string().optional(),
  }),
  execute: async ({ inputData }) => {
    const token = resolveToken(inputData?.token);
    try { console.log('[v2/merge-pr] in', { runId: inputData.runId, number: inputData.number, owner: inputData.owner, repo: inputData.repo }); } catch {}

    // Best-effort approve (ignore failures, as many repos do not require/allow explicit approvals via token)
    try {
      const reviewsUrl = `https://api.github.com/repos/${encodeURIComponent(inputData.owner)}/${encodeURIComponent(inputData.repo)}/pulls/${inputData.number}/reviews`;
      await fetch(reviewsUrl, {
        method: 'POST',
        headers: { ...buildHeaders(token, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'APPROVE', body: 'Automated approval' }),
      });
    } catch {}

    // Merge
    const mergeUrl = `https://api.github.com/repos/${encodeURIComponent(inputData.owner)}/${encodeURIComponent(inputData.repo)}/pulls/${inputData.number}/merge`;
    const res = await fetch(mergeUrl, {
      method: 'PUT',
      headers: { ...buildHeaders(token, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ merge_method: 'merge' }),
    });
    await throwIfNotOk(res);
    const data = await res.json();
    const out = { number: inputData.number, url: inputData.url, merged: !!data.merged, sha: data.sha, message: data.message };
    try { console.log('[v2/merge-pr] out', { runId: inputData.runId, ...out }); } catch {}
    return out;
  },
});

// Step 9: Initialize Freestyle sandbox and print URL
const initFreestyle = createStep({
  id: 'init-freestyle',
  description: 'Create a Freestyle sandbox from dev branch and print the ephemeral URL',
  inputSchema: mergePr.outputSchema,
  outputSchema: z.object({
    runId: z.string().optional(),
    prNumber: z.number(),
    merged: z.boolean(),
    freestyleUrl: z.string().optional(),
  }),
  execute: async ({ inputData }) => {
    let url: string | undefined;
    try {
      url = await initFreestyleSandbox();
      try { console.log('[v2/init-freestyle] sandbox_url', { runId: (inputData as any).runId, url }); } catch {}
    } catch (err) {
      try { console.error('[v2/init-freestyle] failed', String(err)); } catch {}
    }
    return { runId: (inputData as any).runId, prNumber: inputData.number, merged: (inputData as any).merged === true, freestyleUrl: url };
  },
});

export const fixFromStacktraceWorkflowV2 = createWorkflow({
  id: 'fix-from-stacktrace-v2',
  inputSchema: prepareInput.inputSchema,
  outputSchema: initFreestyle.outputSchema,
})
  .then(prepareInput)
  .then(parseInput)
  .then(resolveRepo)
  .then(locateFile)
  .then(readFile)
  .then(proposeFix)
  .then(commitFix)
  .then(openPr)
  .then(mergePr)
  .then(initFreestyle);

fixFromStacktraceWorkflowV2.commit();

// Simple programmatic runner for environments where .start is not wired
export async function startFixFromStacktraceV2(input: z.infer<typeof prepareInput.inputSchema>) {
  const runId = generateRunId();
  console.log('[v2] manual-run begin', { runId });
  try {
    const prep = await (prepareInput as any).execute({ inputData: input });
    const p = await (parseInput as any).execute({ inputData: prep });
    p.runId = p.runId || runId;
    const r = await (resolveRepo as any).execute({ inputData: p });
    const l = await (locateFile as any).execute({ inputData: r });
    const rf = await (readFile as any).execute({ inputData: l });
    const pf = await (proposeFix as any).execute({ inputData: rf });
    const cm = await (commitFix as any).execute({ inputData: pf });
    const pr = await (openPr as any).execute({ inputData: cm });
    const mg = await (mergePr as any).execute({ inputData: pr });
    const fs = await (initFreestyle as any).execute({ inputData: mg });
    console.log('[v2] manual-run done', { runId, pr: { number: pr.number, url: pr.url }, merged: mg?.merged, freestyleUrl: fs?.freestyleUrl });
    return fs;
  } catch (err) {
    console.error('[v2] manual-run error', { runId, err: String(err) });
    throw err;
  }
}