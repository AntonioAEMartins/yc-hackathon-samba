import { z } from "zod";

/** ── Minimal stack frame: where to patch ─────────────────────────────────── */
export const Frame = z
  .object({
    abs_path: z.string().optional(),      // e.g. /app/src/...
    filename: z.string().optional(),      // e.g. src/.../handler.ts
    function: z.string().optional(),      // e.g. createFriend
    module: z.string().optional(),        // e.g. friends.router.ts
    lineno: z.number().int().optional(),
    colno: z.number().int().optional(),
    in_app: z.boolean().optional(),       // prefer frames marked in_app
    context_line: z.string().optional(),  // for quick local reasoning
    pre_context: z.array(z.string()).optional(),
    post_context: z.array(z.string()).optional(),
  })
  .refine(f => !!(f.abs_path || f.filename), {
    message: "frame must have abs_path or filename",
  });

export const Stacktrace = z.object({
  frames: z.array(Frame).min(1),
});

export const ExceptionItem = z.object({
  type: z.string().optional(),            // Error class
  value: z.string().optional(),           // Error message
  stacktrace: Stacktrace.optional(),
});

export const Exceptions = z.object({
  values: z.array(ExceptionItem).min(1),
});

/** ── Minimal HTTP request context: route + repro ─────────────────────────── */
export const Req = z.object({
  method: z.string(),                     // "POST"
  url: z.string().url(),                  // "http://localhost:3000/api/friends"
});

/** ── Minimal runtime + trace: correlate spans & env ─────────────────────── */
export const Contexts = z.object({
  trace: z
    .object({
      trace_id: z.string(),
      span_id: z.string().optional(),
      parent_span_id: z.string().optional(),
    })
    .partial()
    .optional(),
  runtime: z
    .object({
      name: z.string().optional(),        // "node"
      version: z.string().optional(),     // "v22.12.0"
    })
    .partial()
    .optional(),
}).partial();

/** ── Minimal event core ──────────────────────────────────────────────────── */
export const SentryEventMinimal = z.object({
  event_id: z.string(),                   // primary key for dedup
  level: z.string().optional(),           // "error"
  environment: z.string().optional(),     // "development" | "production"
  release: z.string().optional(),         // deploy correlation
  transaction: z.string().optional(),     // "POST /api/[[...route]]"
  culprit: z.string().optional(),         // sometimes same as transaction
  location: z.string().optional(),        // best-guess source path
  message: z.string().optional(),         // error message/title
  metadata: z
    .object({
      filename: z.string().optional(),
      function: z.string().optional(),
      type: z.string().optional(),
      value: z.string().optional(),
    })
    .partial()
    .optional(),

  request: Req,
  exception: Exceptions.optional(),
  contexts: Contexts.optional(),

  // Handy deep-links (not required for reasoning, but useful for ops)
  web_url: z.string().url().optional(),
  issue_url: z.string().url().optional(),
});

/** ── Minimal webhook envelope ────────────────────────────────────────────── */
export const SentryWebhookMinimal = z.object({
  action: z.string(),                     // "created"
  data: z.object({
    error: SentryEventMinimal,
  }),
});

export type TFrame = z.infer<typeof Frame>;
export type TStacktrace = z.infer<typeof Stacktrace>;
export type TSentryEventMinimal = z.infer<typeof SentryEventMinimal>;
export type TSentryWebhookMinimal = z.infer<typeof SentryWebhookMinimal>;
