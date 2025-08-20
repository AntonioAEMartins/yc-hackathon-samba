import { createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { prepareInput } from '../steps/00-fake-sentry-prompt.js';
import { parseInput } from '../steps/01-parse-input.js';
import { locateFile } from '../steps/03-locate-file.js';

// Test workflow for the bug discovery part - covers steps 0-4
// This workflow tests: input preparation, parsing, repo resolution, file location, and file reading
export const testDiscoveryWorkflow = createWorkflow({
  id: 'test-discovery-workflow',
  inputSchema: z.object({
    prompt: z.string().optional(),
    owner: z.string().optional(),
    repo: z.string().optional(),
    token: z.string().optional(),
    prTitle: z.string().optional(),
    prBody: z.string().optional(),
  }),
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
})
  .then(prepareInput)
  .then(parseInput)
  .then(locateFile)

testDiscoveryWorkflow.commit();

// Simple programmatic runner for testing discovery workflow
export async function startTestDiscoveryWorkflow(input: z.infer<typeof prepareInput.inputSchema>) {
  console.log('[test-discovery] Starting bug discovery test workflow...');
  try {
    const prep = await (prepareInput as any).execute({ inputData: input });
    console.log('[test-discovery] ✓ Input prepared');
    
    const parsed = await (parseInput as any).execute({ inputData: prep });
    console.log('[test-discovery] ✓ Input parsed', { 
      hasRepoUrl: !!parsed.repoUrl, 
      explicitPath: parsed.explicitPath, 
      candidates: parsed.fileCandidates.length 
    });
    
    const located = await (locateFile as any).execute({ inputData: parsed });
    console.log('[test-discovery] ✓ File located', { 
      path: located.candidatePath,
      line: located.line,
      column: located.column
    });
    
    console.log('[test-discovery] ✅ Bug discovery workflow completed successfully!');
    return located;
  } catch (err) {
    console.error('[test-discovery] ❌ Bug discovery workflow failed:', String(err));
    throw err;
  }
}