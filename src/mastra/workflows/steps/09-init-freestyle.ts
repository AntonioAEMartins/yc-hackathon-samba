import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
// import { initFreestyleSandbox } from '../../freestyle_init.js';

// Step 9: Initialize Freestyle sandbox and print URL (DISABLED)
export const initFreestyle = createStep({
  id: 'init-freestyle',
  description: 'Freestyle sandbox initialization (disabled)',
  inputSchema: z.object({
    number: z.number(),
    url: z.string(),
    merged: z.boolean(),
    sha: z.string().optional(),
    message: z.string().optional(),
  }),
  outputSchema: z.object({
    runId: z.string().optional(),
    prNumber: z.number(),
    merged: z.boolean(),
    freestyleUrl: z.string().optional(),
  }),
  execute: async ({ inputData }) => {
    // Freestyle deployment is commented out
    // let url: string | undefined;
    // try {
    //   url = await initFreestyleSandbox();
    //   try { console.log('[samba/init-freestyle] sandbox_url', { runId: (inputData as any).runId, url }); } catch {}
    // } catch (err) {
    //   try { console.error('[samba/init-freestyle] failed', String(err)); } catch {}
    // }
    
    console.log('[samba/init-freestyle] Freestyle deployment is disabled');
    return { 
      runId: (inputData as any).runId, 
      prNumber: inputData.number, 
      merged: inputData.merged === true, 
      freestyleUrl: undefined // No Freestyle URL since it's disabled
    };
  },
});
