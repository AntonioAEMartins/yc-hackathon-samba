import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

type ParsedFrame = {
  file: string;
  line?: number;
  column?: number;
  function?: string;
  raw: string;
};

type ParsedStackTrace = {
  errorType?: string;
  message?: string;
  languageGuess?: string;
  repoUrlGuess?: string;
  frames: ParsedFrame[];
  raw: string;
};

const GITHUB_URL_REGEX = /(?:https?:\/\/|git@)github\.com[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\.git)?/gi;

function guessLanguage(stack: string): string | undefined {
  if (/^Traceback \(most recent call last\):/m.test(stack)) return 'python';
  if (/\bat\s+.+\(.+?:\d+:\d+\)/m.test(stack) || /^\s*at\s+.+:\d+:\d+$/m.test(stack)) return 'node';
  if (/\bat\s+[\w.$]+\([^)]*\)/m.test(stack) && /\.java:\d+\)/m.test(stack)) return 'java';
  if (/^[^\s].+?:\d+:in\s+`/m.test(stack)) return 'ruby';
  if (/goroutine\s+\d+\s+\[/.test(stack) || /^\s*[\w\/.-]+:\d+\s+\+0x[0-9a-f]+/m.test(stack)) return 'go';
  return undefined;
}

function extractRepoUrl(stack: string): string | undefined {
  let match: RegExpExecArray | null;
  while ((match = GITHUB_URL_REGEX.exec(stack)) !== null) {
    const owner = match[1];
    const repo = match[2].replace(/\.git$/i, '');
    return `https://github.com/${owner}/${repo}`;
  }
  return undefined;
}

function parseFrames(stack: string): ParsedFrame[] {
  const frames: ParsedFrame[] = [];

  const lines = stack.split(/\r?\n/);

  const jsRe = /^\s*at\s+(?:(.*?)\s+\()?(.+?):(\d+):(\d+)\)?$/;
  const pyRe = /^\s*File\s+"(.+?)",\s+line\s+(\d+)(?:,\s+in\s+(.+))?/;
  const javaRe = /^\s*at\s+([\w.$<>]+)\(([^:()]+):(\d+)\)\s*$/;
  const rubyRe = /^\s*([^\s].*?):(\d+):in\s+`([^']+)'/;
  const goReA = /^\s*([\w\/._-]+):(\d+)\s+\+0x[0-9a-f]+\s*$/i; // addr frames
  const goReB = /^\s*(?:\S+)\s+([\w\/._-]+):(\d+)\s*$/; // fallback

  for (const raw of lines) {
    let m: RegExpExecArray | null;
    if ((m = jsRe.exec(raw))) {
      frames.push({ file: m[2], line: Number(m[3]), column: Number(m[4]), function: m[1] || undefined, raw });
      continue;
    }
    if ((m = pyRe.exec(raw))) {
      frames.push({ file: m[1], line: Number(m[2]), function: m[3] || undefined, raw });
      continue;
    }
    if ((m = javaRe.exec(raw))) {
      // function contains class.method, file is second group
      frames.push({ file: m[2], line: Number(m[3]), function: m[1], raw });
      continue;
    }
    if ((m = rubyRe.exec(raw))) {
      frames.push({ file: m[1], line: Number(m[2]), function: m[3], raw });
      continue;
    }
    if ((m = goReA.exec(raw)) || (m = goReB.exec(raw))) {
      frames.push({ file: m[1], line: Number(m[2]), raw });
      continue;
    }
  }
  return frames;
}

function extractErrorHeader(stack: string): { type?: string; message?: string } {
  const first = stack.split(/\r?\n/).find((l) => l.trim().length > 0) || '';
  // JS: ErrorType: message
  const js = /^(\w+Error|TypeError|ReferenceError|RangeError|SyntaxError|AssertionError):\s*(.*)$/.exec(first);
  if (js) return { type: js[1], message: js[2] };
  // Python: Traceback ... then last line like ValueError: message
  const pyLast = stack.trim().split(/\r?\n/).reverse().find((l) => /:\s+/.test(l));
  const py = pyLast ? /^(\w+):\s*(.*)$/.exec(pyLast.trim()) : null;
  if (py) return { type: py[1], message: py[2] };
  // Java: Exception in thread "main" java.lang.NullPointerException: message
  const java = /(?:Exception in thread ".*"\s+)?([\w.]+(?:Exception|Error))(?::\s*(.*))?/.exec(first);
  if (java) return { type: java[1], message: java[2] };
  return { type: undefined, message: undefined };
}

export const parseStackTraceTool = createTool({
  id: 'parse-stack-trace',
  description: 'Parse a stack trace into structured frames, guess language and repo URL',
  inputSchema: z.object({
    stack: z.string().describe('Raw stack trace text'),
  }),
  outputSchema: z.object({
    errorType: z.string().optional(),
    message: z.string().optional(),
    languageGuess: z.string().optional(),
    repoUrlGuess: z.string().optional(),
    frames: z
      .array(
        z.object({
          file: z.string(),
          line: z.number().optional(),
          column: z.number().optional(),
          function: z.string().optional(),
          raw: z.string(),
        }),
      )
      .default([]),
    raw: z.string(),
  }),
  execute: async ({ context }) => {
    const raw = context.stack || '';
    const languageGuess = guessLanguage(raw);
    const repoUrlGuess = extractRepoUrl(raw);
    const frames = parseFrames(raw);
    const header = extractErrorHeader(raw);
    const result: ParsedStackTrace = {
      errorType: header.type,
      message: header.message,
      languageGuess,
      repoUrlGuess,
      frames,
      raw,
    };
    return result;
  },
});

export type ParseStackTraceInput = z.infer<typeof parseStackTraceTool.inputSchema>;
export type ParseStackTraceOutput = z.infer<typeof parseStackTraceTool.outputSchema>;


