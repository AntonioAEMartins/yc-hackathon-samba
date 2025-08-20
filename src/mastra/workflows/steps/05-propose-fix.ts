import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { proposeFixGpt5Tool } from '../../tools/propose-fix-gpt5-tool.js';

// Step 5: Propose fix using GPT-5 tool with full context (file path, content, stack, line)
export const proposeFix = createStep({
  id: 'propose-fix',
  description: 'Derive an updated file content via GPT-5',
  inputSchema: z.object({
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
    try { console.log('[samba/propose-fix] in', { runId: inputData.runId }); } catch {}

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
      try { console.error('[samba/propose-fix] gpt5_error', { runId: inputData.runId, err: String(err) }); } catch {}
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
    try { console.log('[samba/propose-fix] out', { runId: inputData.runId, changed: updated !== inputData.fileText }); } catch {}
    return out;
  },
});
