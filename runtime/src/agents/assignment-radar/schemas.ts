import { z } from 'zod';

export const sources = ['ic', 'omega365', 'kons', 'folq', 'fortehub', 'emagine', 'rightpeoplegroup', 'sperton', '7n'] as const;
// Keep deferred sources readable in stored observations; only active sources may be requested.
export const activeSources = ['ic', 'omega365', 'kons', 'fortehub', 'emagine', 'rightpeoplegroup', 'sperton', '7n'] as const;
export const SourceSchema = z.enum(sources);
export type Source = z.infer<typeof SourceSchema>;
// PostgREST serializes timestamptz columns with offsets; keep the common format in UTC.
const SeenAtSchema = z.string().datetime({ offset: true }).transform(value => new Date(value).toISOString());
export const AssignmentSchema = z.object({
  source: SourceSchema, external_id: z.string().min(1), url: z.string().url(),
  title: z.string().min(1), customer: z.string().nullable(), location: z.string().nullable(),
  deadline: z.string().nullable(), start_date: z.string().nullable(), extent: z.string().nullable(),
  description: z.string(), first_seen_at: SeenAtSchema, last_seen_at: SeenAtSchema,
});
export type Assignment = z.infer<typeof AssignmentSchema>;
export const ProfileSchema = z.object({
  maxExtent: z.number().min(1).max(100).default(100),
  preferredLocations: z.array(z.string().min(1)).default(['Oslo', 'Lysaker', 'Fornebu']),
});
export type Profile = z.infer<typeof ProfileSchema>;
export const InputSchema = z.object({
  sources: z.array(z.enum(activeSources)).min(1).default([...activeSources]),
  threshold: z.number().int().min(0).max(100).optional(),
  profile: ProfileSchema.default({}),
});
export type RadarInput = z.infer<typeof InputSchema>;
export const ScoreSchema = z.object({
  total: z.number().int().min(0).max(100), relevant: z.boolean(),
  breakdown: z.record(z.number()), reasons: z.array(z.string()), gaps: z.array(z.string()),
  action: z.string(),
});
export type Score = z.infer<typeof ScoreSchema>;
export const OutputSchema = z.object({
  found: z.number(), new: z.number(), duplicates: z.number(), filtered: z.number(), posted: z.number(),
  sources: z.array(z.object({ source: SourceSchema, found: z.number(), errors: z.array(z.string()) })),
  errors: z.array(z.string()),
});
export type RadarOutput = z.infer<typeof OutputSchema>;
export interface StoredAssignment { id: string; assignment: Assignment; observations: Assignment[]; score: Score }
