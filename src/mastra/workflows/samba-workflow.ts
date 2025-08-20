import { createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { githubMCP } from '../mcps/github-mcp-client.js';
import { prepareInput } from './steps/00-fake-sentry-prompt.js';
import { parseInput } from './steps/01-parse-input.js';
import { resolveRepo } from './steps/02-resolve-repo.js';
import { locateFile } from './steps/03-locate-file.js';
import { proposeFix } from './steps/05-propose-fix.js';
import { commitFix } from './steps/06-commit-fix.js';
import { openPr } from './steps/07-open-pr.js';
import { mergePr } from './steps/08-merge-pr.js';
import { initFreestyle } from './steps/09-init-freestyle.js';
import { generateRunId } from './steps/utils.js';

// Minimal MCP helper wrappers
async function mcpCall(toolName: string, args: Record<string, unknown>) {
  const res: any = await (githubMCP as any).callTool(toolName, args);
  if (res && typeof res === 'object' && 'error' in res && res.error) {
    throw new Error(String((res as any).error));
  }
  return (res && (res.data ?? res)) as any;
}

export const sambaWorkflow = createWorkflow({
  id: 'samba-workflow',
  inputSchema: prepareInput.inputSchema,
  outputSchema: initFreestyle.outputSchema,
})
  .then(prepareInput)
  .then(parseInput)
  .then(resolveRepo)
  .then(locateFile)
  // .then(proposeFix)
  // .then(commitFix)
  // .then(openPr)
  // .then(mergePr)
  // .then(initFreestyle);

sambaWorkflow.commit();

// Simple programmatic runner for environments where .start is not wired
export async function startSambaWorkflow(input: z.infer<typeof prepareInput.inputSchema>) {
  const runId = generateRunId();
  console.log('[samba] manual-run begin', { runId });
  try {
    const prep = await (prepareInput as any).execute({ inputData: input });
    const p = await (parseInput as any).execute({ inputData: prep });
    p.runId = p.runId || runId;
    const r = await (resolveRepo as any).execute({ inputData: p });
    const l = await (locateFile as any).execute({ inputData: r });
    // const pf = await (proposeFix as any).execute({ inputData: l });
    // const cm = await (commitFix as any).execute({ inputData: pf });
    // const pr = await (openPr as any).execute({ inputData: cm });
    // const mg = await (mergePr as any).execute({ inputData: pr });
    // const fs = await (initFreestyle as any).execute({ inputData: mg });
    console.log('[samba] manual-run done', { runId, pr: { number: l.number, url: l.url }, merged: (l as any)?.merged, freestyleUrl: (l as any)?.freestyleUrl });
    return l;
  } catch (err) {
    console.error('[samba] manual-run error', { runId, err: String(err) });
    throw err;
  }
}