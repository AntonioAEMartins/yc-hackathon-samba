import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { generateRunId } from './utils.js';

// Step 1: Parse input prompt for repo URL, explicit file path, and stack frames
export const parseInput = createStep({
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
    try { console.log('[samba/parse-input] in', { runId, promptSize: inputData.prompt.length }); } catch {}
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
    try { console.log('[samba/parse-input] out', { runId, hasRepoUrl: !!repoUrl, explicitPath, candidates: fileCandidates.length }); } catch {}
    return out;
  },
});
