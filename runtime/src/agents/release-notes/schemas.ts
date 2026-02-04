import { z } from 'zod';

export const CommitSchema = z.object({
  sha: z.string(),
  message: z.string(),
  author: z.string(),
  url: z.string().url(),
});

export type Commit = z.infer<typeof CommitSchema>;

export const FixtureModeInputSchema = z.object({
  mode: z.literal('fixture'),
  repo: z.string(),
  rangeLabel: z.string(),
  commits: z.array(CommitSchema),
});

export const GithubModeInputSchema = z.object({
  mode: z.literal('github'),
  repo: z.string(),
  from: z.string(),
  to: z.string(),
});

export const ReleaseNotesInputSchema = z.discriminatedUnion('mode', [
  FixtureModeInputSchema,
  GithubModeInputSchema,
]);

export type ReleaseNotesInput = z.infer<typeof ReleaseNotesInputSchema>;

export const ChangeCategory = z.enum(['features', 'fixes', 'chores']);
export type ChangeCategory = z.infer<typeof ChangeCategory>;

export const CategorizedCommitSchema = z.object({
  sha: z.string(),
  message: z.string(),
  author: z.string(),
  url: z.string(),
  category: ChangeCategory,
  isHighlight: z.boolean(),
  riskKeywords: z.array(z.string()),
});

export type CategorizedCommit = z.infer<typeof CategorizedCommitSchema>;

export const ReleaseNotesOutputSchema = z.object({
  title: z.string(),
  highlights: z.array(z.string()),
  changes: z.object({
    features: z.array(CategorizedCommitSchema),
    fixes: z.array(CategorizedCommitSchema),
    chores: z.array(CategorizedCommitSchema),
  }),
  riskNotes: z.array(z.string()),
});

export type ReleaseNotesOutput = z.infer<typeof ReleaseNotesOutputSchema>;
