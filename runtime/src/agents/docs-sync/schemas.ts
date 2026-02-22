import { z } from 'zod';

export const ChangedFileSchema = z.object({
  path: z.string(),
  diff: z.string(),
  status: z.enum(['added', 'modified', 'removed']),
});

export type ChangedFile = z.infer<typeof ChangedFileSchema>;

export const ContentPageSchema = z.object({
  path: z.string(),
  content: z.string(),
});

export type ContentPage = z.infer<typeof ContentPageSchema>;

export const DocsSyncInputSchema = z.object({
  repo: z.string(),
  ref: z.string(),
  beforeSha: z.string(),
  afterSha: z.string(),
  changedFiles: z.array(ChangedFileSchema).min(1),
  contentPages: z.array(ContentPageSchema).min(1),
  commitMessages: z.array(z.string()),
});

export type DocsSyncInput = z.infer<typeof DocsSyncInputSchema>;

export const SuggestedUpdateSchema = z.object({
  path: z.string(),
  originalContent: z.string(),
  updatedContent: z.string(),
  reason: z.string(),
});

export type SuggestedUpdate = z.infer<typeof SuggestedUpdateSchema>;

export const DocsSyncOutputSchema = z.object({
  hasUpdates: z.boolean(),
  summary: z.string(),
  suggestedUpdates: z.array(SuggestedUpdateSchema),
  prTitle: z.string(),
  prBody: z.string(),
});

export type DocsSyncOutput = z.infer<typeof DocsSyncOutputSchema>;
