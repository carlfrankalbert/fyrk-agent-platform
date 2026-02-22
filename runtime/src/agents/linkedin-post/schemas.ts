import { z } from 'zod';

export const FeedArticleSchema = z.object({
  title: z.string().min(1),
  url: z.string().url(),
  summary: z.string(),
  publishedAt: z.string(),
  source: z.string(),
});

export type FeedArticle = z.infer<typeof FeedArticleSchema>;

export const LinkedInPostInputSchema = z.object({
  articles: z.array(FeedArticleSchema).min(1),
  topics: z.array(z.string()).optional(),
  maxPosts: z.number().int().min(1).max(10).optional(),
  language: z.enum(['no', 'en']).optional(),
  tone: z.enum(['professional', 'conversational', 'thought-leader']).optional(),
});

export type LinkedInPostInput = z.infer<typeof LinkedInPostInputSchema>;

export const SourceArticleSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  source: z.string(),
});

export const DraftPostSchema = z.object({
  title: z.string(),
  postText: z.string(),
  sourceArticle: SourceArticleSchema,
  hashtags: z.array(z.string()),
  topic: z.string(),
  characterCount: z.number(),
});

export type DraftPost = z.infer<typeof DraftPostSchema>;

export const LinkedInPostOutputSchema = z.object({
  drafts: z.array(DraftPostSchema),
  totalArticlesAnalyzed: z.number(),
  generatedAt: z.string(),
  hasDrafts: z.boolean(),
});

export type LinkedInPostOutput = z.infer<typeof LinkedInPostOutputSchema>;
