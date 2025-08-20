import { z } from 'zod';

// File candidate schema for inputs
const FileCandidateSchema = z.object({
  pathOrName: z.string(),
  line: z.number().nullable(),
  column: z.number().nullable(),
  explicitPath: z.string().nullable(),
});

// Run information schema
const RunSchema = z.object({
  runId: z.string(),
  owner: z.string(),
  repo: z.string(),
  baseBranch: z.string(),
  receivedAt: z.string(),
});

// Inputs schema
const InputsSchema = z.object({
  prompt: z.string(),
  errorHeader: z.string().nullable(),
  fileCandidates: z.array(FileCandidateSchema),
});

// Detected language schema
const DetectedLanguageSchema = z.object({
  language: z.string(),
  percent: z.number(),
});

// Entry point schema
const EntryPointSchema = z.object({
  path: z.string(),
  reason: z.string(),
});

// Repository summary schema
const RepoSummarySchema = z.object({
  detectedLanguages: z.array(DetectedLanguageSchema),
  packageManagers: z.array(z.string()),
  frameworks: z.array(z.string()),
  workspaceRoots: z.array(z.string()),
  isMonorepo: z.boolean(),
  entryPoints: z.array(EntryPointSchema),
  codeowners: z.boolean(),
});

// Weights schema for signals
const WeightsSchema = z.object({
  StackTraceMatch: z.number(),
  IdentifierOverlap: z.number(),
  ImportGraphProximity: z.number(),
  RecentChange: z.number(),
  PathHeuristics: z.number(),
  Ownership: z.number(),
  TestLinkage: z.number(),
});

// Stack trace match schema
const StackTraceMatchSchema = z.object({
  path: z.string(),
  line: z.number().nullable(),
  column: z.number().nullable(),
  matchType: z.enum(['exact', 'fuzzy']),
  score: z.number(),
});

// Signals schema
const SignalsSchema = z.object({
  weights: WeightsSchema,
  stackTraceMatches: z.array(StackTraceMatchSchema),
  identifiers: z.array(z.string()),
  unmatchedHints: z.array(z.string()),
});

// Score breakdown schema
const ScoreBreakdownSchema = z.object({
  StackTraceMatch: z.number().nullable(),
  IdentifierOverlap: z.number().nullable(),
  ImportGraphProximity: z.number().nullable(),
  RecentChange: z.number().nullable(),
  PathHeuristics: z.number().nullable(),
  Ownership: z.number().nullable(),
  TestLinkage: z.number().nullable(),
});

// Top span schema
const TopSpanSchema = z.object({
  startLine: z.number(),
  endLine: z.number(),
  reason: z.string(),
});

// Related test schema
const RelatedTestSchema = z.object({
  path: z.string(),
});

// Ranked file schema
const RankedFileSchema = z.object({
  path: z.string(),
  language: z.string().nullable(),
  score: z.number(),
  scoreBreakdown: ScoreBreakdownSchema,
  reasons: z.array(z.string()),
  topSpans: z.array(TopSpanSchema),
  relatedTests: z.array(RelatedTestSchema),
  owners: z.array(z.string()),
});

// Next action schema
const NextActionSchema = z.object({
  type: z.literal('inspect_file'),
  detail: z.string(),
  path: z.string(),
});

// Main GitHub agent output schema
export const GitHubAgentOutputSchema = z.object({
  run: RunSchema,
  inputs: InputsSchema,
  repoSummary: RepoSummarySchema,
  signals: SignalsSchema,
  rankedFiles: z.array(RankedFileSchema),
  nextActions: z.array(NextActionSchema),
  confidence: z.number(),
  notes: z.string().nullable(),
});

// Type inference for TypeScript
export type GitHubAgentOutput = z.infer<typeof GitHubAgentOutputSchema>;

// Individual schema exports for reuse
export {
  FileCandidateSchema,
  RunSchema,
  InputsSchema,
  DetectedLanguageSchema,
  EntryPointSchema,
  RepoSummarySchema,
  WeightsSchema,
  StackTraceMatchSchema,
  SignalsSchema,
  ScoreBreakdownSchema,
  TopSpanSchema,
  RelatedTestSchema,
  RankedFileSchema,
  NextActionSchema,
};
