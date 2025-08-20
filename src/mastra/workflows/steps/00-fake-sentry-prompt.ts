import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { SentryWebhookMinimal, type TSentryEventMinimal } from '../../sentry-schema.js';

// Real Sentry payload data for realistic testing
const REAL_SENTRY_PAYLOAD = {
  "action": "created",
  "data": {
    "error": {
      "event_id": "3f5c1540dbaf41f6aa0db0c2cd9e7613",
      "level": "error",
      "environment": "development",
      "release": "b8dce913b03c455a816f0335feffc60274ebd2b5",
      "transaction": "POST /api/[[...route]]",
      "culprit": "POST /api/[[...route]]",
      "location": "src/server/modules/friends/friends.router.ts",
      "message": "Demo: CreateFriend crash",
      "metadata": {
        "filename": "src/server/modules/friends/friends.router.ts",
        "function": "eval",
        "type": "Error",
        "value": "Demo: CreateFriend crash"
      },
      "request": {
        "url": "http://localhost:3000/api/friends",
        "method": "POST"
      },
      "exception": {
        "values": [
          {
            "type": "Error",
            "value": "Demo: CreateFriend crash",
            "stacktrace": {
              "frames": [
                {
                  "function": "eval",
                  "module": "friends.router.ts", 
                  "filename": "src/server/modules/friends/friends.router.ts",
                  "abs_path": "src/server/modules/friends/friends.router.ts",
                  "lineno": 171,
                  "colno": 13,
                  "pre_context": [
                    "     const body = ctx.req.valid(\"json\");",
                    "     if (body.name?.toLowerCase().includes(\"crash\")) {"
                  ],
                  "context_line": "       throw new Error(\"Demo: CreateFriend crash\");",
                  "post_context": [
                    "     }",
                    "     const friend = await prisma.friend.create({",
                    "       data: {"
                  ],
                  "in_app": true
                }
              ]
            }
          }
        ]
      },
      "contexts": {
        "trace": {
          "trace_id": "f90c926c150c54126649671484ffc7ef",
          "span_id": "3559bef6696e9b52",
          "parent_span_id": "1d0dee334e4e4176"
        },
        "runtime": {
          "name": "node",
          "version": "v22.12.0"
        }
      },
      "web_url": "https://sentry.io/organizations/pedro-stanzani/issues/6818814471/events/3f5c1540dbaf41f6aa0db0c2cd9e7613/",
      "issue_url": "https://sentry.io/api/0/organizations/pedro-stanzani/issues/6818814471/"
    }
  }
};

function extractStackTraceFromSentryEvent(sentryEvent: TSentryEventMinimal): string {
  const lines: string[] = [];
  
  // Add the main error message
  if (sentryEvent.message) {
    lines.push(sentryEvent.message);
  }
  
  // Extract stack frames from exception
  if (sentryEvent.exception?.values?.[0]?.stacktrace?.frames) {
    const frames = sentryEvent.exception.values[0].stacktrace.frames;
    
    // Reverse frames to show the most relevant (deepest) first
    const relevantFrames = frames.slice().reverse();
    
    for (const frame of relevantFrames) {
      if (frame.filename && frame.lineno) {
        const functionName = frame.function || 'anonymous';
        const location = `${frame.filename}:${frame.lineno}:${frame.colno || 0}`;
        lines.push(`    at ${functionName} (${location})`);
        
        // Stop after a reasonable number of frames for readability
        if (lines.length > 10) break;
      }
    }
  }
  
  return lines.join('\n');
}

function extractFilePathFromSentryEvent(sentryEvent: TSentryEventMinimal): string | undefined {
  // Try location field first
  if (sentryEvent.location) {
    return sentryEvent.location;
  }
  
  // Try metadata filename
  if (sentryEvent.metadata?.filename) {
    return sentryEvent.metadata.filename;
  }
  
  // Try to find the first in_app frame
  const inAppFrame = sentryEvent.exception?.values?.[0]?.stacktrace?.frames?.find(
    frame => frame.in_app && frame.filename
  );
  
  if (inAppFrame?.filename) {
    return inAppFrame.filename;
  }
  
  // Fallback to any frame with a filename that looks like application code
  const appFrame = sentryEvent.exception?.values?.[0]?.stacktrace?.frames?.find(
    frame => frame.filename && 
             (frame.filename.includes('src/') || 
              frame.filename.includes('app/') ||
              frame.filename.includes('lib/'))
  );
  
  return appFrame?.filename;
}

function extractRepoInfoFromSentryEvent(sentryEvent: TSentryEventMinimal): { owner?: string; repo?: string } {
  // This would normally come from environment variables or Sentry project configuration
  // For now, use defaults based on the request URL pattern
  const url = sentryEvent.request?.url;
  
  if (url?.includes('localhost')) {
    // Development environment - use the test repo
    return {
      owner: 'AntonioAEMartins',
      repo: 'yc-hackathon-social'
    };
  }
  
  // In production, this could be extracted from deployment metadata
  return {
    owner: 'AntonioAEMartins',
    repo: 'yc-hackathon-social'
  };
}

// Step 0: Prepare input. In dev, synthesize a realistic Sentry prompt using actual schema
export const prepareInput = createStep({
    id: 'prepare-input',
    description: 'Prepare workflow input. In dev, generate a realistic Sentry prompt using actual payload data.',
    inputSchema: z.object({
        prompt: z.string().optional(),
        owner: z.string().optional(),
        repo: z.string().optional(),
        token: z.string().optional(),
        prTitle: z.string().optional(),
        prBody: z.string().optional(),
        sentryPayload: z.any().optional(), // Allow raw Sentry webhook payload
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
            try {
                // Parse the Sentry payload using our schema
                let sentryData = inputData?.sentryPayload || REAL_SENTRY_PAYLOAD;
                
                // Validate against our schema
                const validatedPayload = SentryWebhookMinimal.parse(sentryData);
                const sentryEvent = validatedPayload.data.error;
                
                // Extract information using our schema-aware functions
                const stackTrace = extractStackTraceFromSentryEvent(sentryEvent);
                const filePath = extractFilePathFromSentryEvent(sentryEvent);
                const repoInfo = extractRepoInfoFromSentryEvent(sentryEvent);
                
                // Use input overrides or extracted values
                const owner = inputData?.owner || repoInfo.owner || 'AntonioAEMartins';
                const repo = inputData?.repo || repoInfo.repo || 'yc-hackathon-social';
                const branch = 'main'; // Could be extracted from release/environment
                
                // Build the prompt sections
                const sections: string[] = [];
                
                // Error information
                sections.push('Sentry Alert Details:');
                sections.push(`Event ID: ${sentryEvent.event_id}`);
                sections.push(`Environment: ${sentryEvent.environment || 'unknown'}`);
                sections.push(`Transaction: ${sentryEvent.transaction || 'unknown'}`);
                sections.push('');
                
                // Stack trace
                sections.push('Stack trace:');
                sections.push(stackTrace);
                sections.push('');
                
                // Repository information
                if (filePath) {
                    const repoUrl = `https://github.com/${owner}/${repo}/blob/${branch}/${filePath}`;
                    sections.push('Repo URL:');
                    sections.push(repoUrl);
                    sections.push('');
                    sections.push('File relative path:');
                    sections.push(filePath);
                }
                
                // Request context
                if (sentryEvent.request) {
                    sections.push('');
                    sections.push('Request Context:');
                    sections.push(`Method: ${sentryEvent.request.method}`);
                    sections.push(`URL: ${sentryEvent.request.url}`);
                }
                
                // Additional context
                if (sentryEvent.contexts?.runtime) {
                    sections.push('');
                    sections.push('Runtime:');
                    sections.push(`${sentryEvent.contexts.runtime.name} ${sentryEvent.contexts.runtime.version}`);
                }
                
                const prompt = sections.join('\n');
                
                // Generate descriptive PR title from Sentry data
                const prTitle = inputData?.prTitle || 
                    `Fix: ${sentryEvent.metadata?.type || 'Error'} in ${filePath ? filePath.split('/').pop() : 'application'} (Sentry Alert)`;
                
                const prBody = inputData?.prBody || 
                    `Automated fix for Sentry error:\n\n` +
                    `**Error:** ${sentryEvent.message || sentryEvent.metadata?.value || 'Unknown error'}\n` +
                    `**File:** ${filePath || 'Unknown'}\n` +
                    `**Environment:** ${sentryEvent.environment || 'Unknown'}\n` +
                    `**Event ID:** ${sentryEvent.event_id}\n\n` +
                    `**Sentry Link:** ${sentryEvent.web_url || 'N/A'}`;

                try { 
                    console.log('[samba/prepare-input] realistic Sentry prompt generated from schema', {
                        eventId: sentryEvent.event_id,
                        filePath,
                        owner,
                        repo,
                        environment: sentryEvent.environment
                    }); 
                } catch { }
                
                return {
                    prompt: String(prompt),
                    owner,
                    repo,
                    token: inputData?.token,
                    prTitle,
                    prBody,
                };
                
            } catch (error) {
                console.warn('[samba/prepare-input] Failed to parse Sentry payload, falling back to simple prompt', error);
                
                // Fallback to simple synthetic data
                const owner = inputData?.owner || 'AntonioAEMartins';
                const repo = inputData?.repo || 'yc-hackathon-social';
                const filePath = 'src/server/modules/friends/friends.router.ts';
                const repoUrl = `https://github.com/${owner}/${repo}/blob/main/${filePath}`;
                
                const stackLines: string[] = [
                    'Error: Demo: CreateFriend crash',
                    '    at eval (src/server/modules/friends/friends.router.ts:171:13)',
                    '    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)',
                ];
                
                const sections: string[] = [];
                sections.push('Stack trace:');
                sections.push(stackLines.join('\n'));
                sections.push('\nRepo URL:');
                sections.push(repoUrl);
                sections.push('\nFile relative path:');
                sections.push(filePath);
                
                return {
                    prompt: sections.join('\n'),
                    owner,
                    repo,
                    token: inputData?.token,
                    prTitle: inputData?.prTitle || 'Automated fix from Sentry alert (dev fallback)',
                    prBody: inputData?.prBody,
                };
            }
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

// Helper function to test with real Sentry payload
export function createSentryPayloadInput(overrides: Partial<any> = {}) {
    return {
        sentryPayload: REAL_SENTRY_PAYLOAD,
        ...overrides
    };
}

// Helper function to test with custom Sentry-like payload
export function createCustomSentryInput(customPayload: any, overrides: Partial<any> = {}) {
    return {
        sentryPayload: customPayload,
        ...overrides
    };
}
