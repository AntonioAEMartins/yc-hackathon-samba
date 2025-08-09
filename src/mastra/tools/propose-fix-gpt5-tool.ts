import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const proposeFixGpt5Tool = createTool({
  id: 'propose-fix-gpt5',
  description: 'Use GPT-5 to propose a minimal, safe fix to a single file based on stack trace and context',
  inputSchema: z.object({
    filePath: z.string(),
    fileText: z.string(),
    stack: z.string().optional(),
    errorHeader: z.string().optional(),
    prompt: z.string().optional(),
    language: z.string().optional(),
    line: z.number().optional(),
    column: z.number().optional(),
  }),
  outputSchema: z.object({
    updatedText: z.string(),
  }),
  execute: async ({ context }) => {
    const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_GPT5 || '';
    const modelName = process.env.GPT5_MODEL || 'gpt-5';

    const system = [
      'You are an expert software engineer. You will fix a single file to resolve the error context.',
      'Rules:',
      '- Output ONLY the full updated file content. No explanations.',
      '- Make the smallest safe change that resolves the error.',
      '- Preserve formatting, imports, and comments unless strictly necessary.',
      '- If unsure, add safe guards or type checks instead of deleting logic.',
    ].join('\n');

    let snippet = '';
    try {
      if (context.line != null && typeof context.fileText === 'string') {
        const lines = context.fileText.split(/\r?\n/);
        const idx = Math.max(0, Math.min(lines.length - 1, (context.line as number) - 1));
        const start = Math.max(0, idx - 8);
        const end = Math.min(lines.length, idx + 8);
        const excerpt = lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join('\n');
        snippet = `\nRelevant snippet (lines ${start + 1}-${end}):\n${excerpt}\n`;
      }
    } catch {}

    const user = [
      `File path: ${context.filePath}`,
      context.language ? `Language: ${context.language}` : '',
      (context.line != null) ? `Error line: ${context.line}${context.column != null ? ':' + context.column : ''}` : '',
      context.errorHeader ? `Error/context: ${context.errorHeader}` : '',
      context.stack ? `Stack trace:\n${context.stack}` : '',
      context.prompt ? `Additional user prompt:\n${context.prompt}` : '',
      snippet,
      '',
      'Current file content:\n',
      context.fileText,
    ].filter(Boolean).join('\n');

    if (!apiKey) {
      // No API key, return original to avoid breaking
      return { updatedText: context.fileText };
    }

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        // Some GPT-5 variants only allow default temperature; omit to avoid 400
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`OpenAI error ${res.status}: ${text}`);
    }
    const data = await res.json();
    let updatedText: string = data?.choices?.[0]?.message?.content || context.fileText;

    // Unwrap common Markdown code fences if the model still returns them
    const fenceMatch = updatedText.trim().match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```\s*$/);
    if (fenceMatch && fenceMatch[1]) {
      updatedText = fenceMatch[1];
    }

    return { updatedText };
  },
});

export type ProposeFixGpt5Input = z.infer<typeof proposeFixGpt5Tool.inputSchema>;
export type ProposeFixGpt5Output = z.infer<typeof proposeFixGpt5Tool.outputSchema>;


