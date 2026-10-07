import { z } from 'zod';

const isRealDate = (s: string): boolean => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD').refine(isRealDate, 'invalid date');
export const SlugSchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'expected kebab-case slug');
/** Dotted snake_case, e.g. food.olives or family.father.birth_date. Also keeps PostgREST filters safe. */
export const MemoryKeySchema = z.string().max(120).regex(/^[a-z0-9_]+(\.[a-z0-9_]+)*$/, 'expected dotted snake_case key');
export const TagSchema = z.string().max(40).regex(/^[a-z0-9_-]+$/, 'expected lowercase tag');

export const MemoryTypeSchema = z.enum(['preference', 'opinion', 'fact', 'episode']);
export const VisibilitySchema = z.enum(['private', 'public']);
export const MemorySourceSchema = z.enum(['bootstrap', 'operator', 'content']);
export type MemoryType = z.infer<typeof MemoryTypeSchema>;
export type Visibility = z.infer<typeof VisibilitySchema>;
export type MemorySource = z.infer<typeof MemorySourceSchema>;

export const MemoryValueSchema = z.object({
  /** One third-person sentence, e.g. "Marta dislikes olives." */
  summary: z.string().min(1).max(500),
  /** Short normalized position for preferences/opinions (dislike, likes_some, ...). Used to detect real changes. */
  stance: z.string().max(60).optional(),
  /** A calendar date the fact is about (e.g. a birth date). */
  date: IsoDateSchema.optional(),
  /** True when `date` is an anniversary that recurs every year (birthdays). */
  recursYearly: z.boolean().optional(),
  details: z.record(z.unknown()).optional(),
});
export type MemoryValue = z.infer<typeof MemoryValueSchema>;

/** A memory as proposed or submitted — not yet stored. */
export const MemoryInputSchema = z.object({
  memoryType: MemoryTypeSchema,
  memoryKey: MemoryKeySchema,
  value: MemoryValueSchema,
  occurredAt: IsoDateSchema.optional(),
  validFrom: IsoDateSchema.optional(),
  tags: z.array(TagSchema).max(12).optional(),
  audienceVisibility: VisibilitySchema.optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export type MemoryInput = z.infer<typeof MemoryInputSchema>;

export interface CharacterProfile {
  id: string;
  slug: string;
  displayName: string;
  publicProfile: Record<string, unknown>;
  privateCanon: Record<string, unknown>;
  visualCanon: Record<string, unknown>;
}

export interface CharacterMemory {
  id: string;
  characterId: string;
  memoryType: MemoryType;
  memoryKey: string;
  value: MemoryValue;
  status: 'active' | 'superseded';
  locked: boolean;
  confidence: number;
  validFrom: string | null;
  validTo: string | null;
  occurredAt: string | null;
  supersededBy: string | null;
  source: MemorySource;
  sourceRunId: string | null;
  tags: string[];
  audienceVisibility: Visibility;
  revealedAt: string | null;
  revealedSourceRunId: string | null;
}

/** Fields needed to store a memory; the store fills ids, status and timestamps. */
export interface NewMemory {
  characterId: string;
  memoryType: MemoryType;
  memoryKey: string;
  value: MemoryValue;
  locked: boolean;
  confidence: number;
  validFrom: string | null;
  occurredAt: string | null;
  source: MemorySource;
  sourceRunId: string | null;
  tags: string[];
  audienceVisibility: Visibility;
  revealedAt: string | null;
}

// --- Agent input ---

const CharacterRef = { character: SlugSchema.optional() };

const CreateContentInput = z.object({
  ...CharacterRef,
  action: z.literal('create_content'),
  scene: z.string().min(1).max(1000),
  /** In-world date of the scene. Memories after this date are not known yet. Defaults to today. */
  date: IsoDateSchema.optional(),
});

const RememberInput = z.object({
  ...CharacterRef,
  action: z.literal('remember'),
  /** Natural-language statement, classified by the model into structured memories. */
  text: z.string().min(1).max(2000).optional(),
  /** Structured memories, e.g. approved memoryCandidates from a create_content run. */
  memories: z.array(MemoryInputSchema).min(1).max(20).optional(),
  /** In-world date the statement applies to ("today"). Defaults to today. */
  date: IsoDateSchema.optional(),
  /** The run that caused this memory (e.g. the approved create_content run). Defaults to this run. */
  sourceRunId: z.string().uuid().optional(),
});

const RecallInput = z.object({
  ...CharacterRef,
  action: z.literal('recall'),
  query: z.string().min(1).max(500).optional(),
  /** internal = everything the character knows; audience = only what has been revealed publicly. */
  scope: z.enum(['internal', 'audience']).optional(),
  memoryKeys: z.array(MemoryKeySchema).max(20).optional(),
  keyPrefixes: z.array(MemoryKeySchema).max(20).optional(),
  tags: z.array(TagSchema).max(20).optional(),
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  /** Recall the state as of this in-world date. Defaults to the latest known state. */
  asOf: IsoDateSchema.optional(),
});

const MarkPublicInput = z.object({
  ...CharacterRef,
  action: z.literal('mark_public'),
  memoryIds: z.array(z.string().uuid()).min(1).max(50),
  /** In-world date of the reveal. Defaults to today. */
  revealedAt: IsoDateSchema.optional(),
  /** The run whose approved content revealed the memories. */
  sourceRunId: z.string().uuid().optional(),
});

export const CharacterInputSchema = z
  .discriminatedUnion('action', [CreateContentInput, RememberInput, RecallInput, MarkPublicInput])
  .superRefine((input, ctx) => {
    if (input.action === 'remember' && !input.text === !input.memories) {
      ctx.addIssue({ code: 'custom', message: 'remember needs exactly one of text or memories' });
    }
    if (input.action === 'recall' && !input.query && !input.memoryKeys?.length && !input.keyPrefixes?.length
      && !input.tags?.length && !input.from && !input.to) {
      ctx.addIssue({ code: 'custom', message: 'recall needs a query or at least one filter' });
    }
  });
export type CharacterInput = z.infer<typeof CharacterInputSchema>;
export type CreateContentRequest = z.infer<typeof CreateContentInput>;
export type RememberRequest = z.infer<typeof RememberInput>;
export type RecallRequest = z.infer<typeof RecallInput>;
export type MarkPublicRequest = z.infer<typeof MarkPublicInput>;

// --- Model outputs ---

export const ContentDraftSchema = z.object({
  imagePrompt: z.string().min(1).max(4000),
  captionOptions: z.array(z.string().min(1).max(240)).min(1).max(5),
  continuityChecklist: z.array(z.string().min(1).max(300)).max(20),
  memoryCandidates: z.array(MemoryInputSchema.omit({ audienceVisibility: true, confidence: true })).max(5),
  usedMemoryIds: z.array(z.string()).max(50),
  revealsMemoryIds: z.array(z.string()).max(20),
});
export type ContentDraft = z.infer<typeof ContentDraftSchema>;

export const MemoryClassificationSchema = z.object({
  memories: z.array(MemoryInputSchema.omit({ audienceVisibility: true })).max(10),
  touchesLockedCanon: z.boolean(),
  lockedKeys: z.array(z.string()).max(10).optional(),
});
export type MemoryClassification = z.infer<typeof MemoryClassificationSchema>;

export const RecallPlanSchema = z.object({
  scope: z.enum(['internal', 'audience']).optional(),
  /**
   * Whose memories may answer: 'self' (the character) or a person namespace such as 'family.mother'.
   * null = could not be resolved (nothing matches). Absent = no scoping (structured recall without a question).
   */
  subject: z.string().max(80).nullable().optional(),
  memoryKeys: z.array(MemoryKeySchema).max(20).default([]),
  keyPrefixes: z.array(MemoryKeySchema).max(20).default([]),
  tags: z.array(TagSchema).max(20).default([]),
  terms: z.array(z.string().max(40)).max(20).default([]),
  memoryTypes: z.array(MemoryTypeSchema).max(4).default([]),
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
});
export type RecallPlan = z.infer<typeof RecallPlanSchema>;

/** Tag as the model might write it ("Favorite Food ") → valid tag ("favorite_food"), or null if nothing usable remains. */
export function normalizeTag(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const tag = value.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '').replace(/_+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '');
  return tag && tag.length <= 40 ? tag : null;
}

const uniq = <T>(xs: T[]): T[] => [...new Set(xs)];
const MEMORY_KEY_RE = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;

/**
 * Tolerates harmless formatting in the planner's lookup helpers before strict validation. Only fields where a dropped
 * or rewritten entry can only narrow the lookup are touched: tags, terms, memoryKeys, keyPrefixes. subject,
 * memoryTypes and dates are left as-is (a dropped type or date would broaden recall); a literal null on the optional
 * scope/from/to means "omitted", exactly as the prompt documents.
 */
export function normalizePlannerLookups(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const plan: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  const list = (field: string, fn: (v: unknown) => string | null): void => {
    const value = plan[field];
    if (value === null || value === undefined) { delete plan[field]; return; }
    if (Array.isArray(value)) plan[field] = uniq(value.map(fn).filter((v): v is string => v !== null));
  };
  list('tags', normalizeTag);
  list('terms', v => (typeof v === 'string' && v.trim() && v.trim().length <= 40 ? v.trim() : null));
  const key = (v: unknown): string | null => {
    const k = typeof v === 'string' ? v.trim().toLowerCase() : '';
    return k.length <= 120 && MEMORY_KEY_RE.test(k) ? k : null;
  };
  list('memoryKeys', key);
  list('keyPrefixes', key);
  for (const field of ['scope', 'from', 'to']) if (plan[field] === null) delete plan[field];
  return plan;
}

/**
 * The planner must always state the subject; a plan without one is rejected rather than matched broadly.
 * Lookup helpers are normalized first; subject is validated strictly and resolved by normalizeSubject afterwards.
 */
export const RecallPlannerSchema = z.preprocess(normalizePlannerLookups,
  RecallPlanSchema.extend({ subject: z.string().max(80).nullable() }));

// --- Agent output ---

const CreateContentOutput = ContentDraftSchema.extend({
  action: z.literal('create_content'),
  characterId: z.string(),
  date: IsoDateSchema,
  /** Always false: candidates become history only through an explicit remember. */
  memoryCandidatesPersisted: z.literal(false),
});

const RememberOutput = z.object({
  action: z.literal('remember'),
  characterId: z.string(),
  dryRun: z.boolean(),
  written: z.array(z.object({
    id: z.string().nullable(),
    memoryType: MemoryTypeSchema,
    memoryKey: z.string(),
    operation: z.enum(['inserted', 'superseded', 'unchanged']),
    supersededId: z.string().optional(),
  })),
});

const RecallOutput = z.object({
  action: z.literal('recall'),
  characterId: z.string(),
  scope: z.enum(['internal', 'audience']),
  asOf: IsoDateSchema.nullable(),
  /** Subject the recall was scoped to; null when unscoped or unresolved. */
  subject: z.string().nullable(),
  answer: z.string(),
  current: z.array(z.string()),
  history: z.array(z.string()),
  episodes: z.array(z.string()),
  memoryIds: z.array(z.string()),
  /** Audience scope only: ids of matching memories that exist internally but were never revealed. */
  unrevealedMemoryIds: z.array(z.string()).optional(),
});

const MarkPublicOutput = z.object({
  action: z.literal('mark_public'),
  characterId: z.string(),
  dryRun: z.boolean(),
  updated: z.array(z.object({ id: z.string(), memoryKey: z.string(), revealedAt: z.string() })),
  alreadyPublic: z.array(z.string()),
  notFound: z.array(z.string()),
});

export const CharacterOutputSchema = z.discriminatedUnion('action', [
  CreateContentOutput, RememberOutput, RecallOutput, MarkPublicOutput,
]);
export type CharacterOutput = z.infer<typeof CharacterOutputSchema>;
export type CreateContentOutput = z.infer<typeof CreateContentOutput>;
export type RememberOutput = z.infer<typeof RememberOutput>;
export type RecallOutput = z.infer<typeof RecallOutput>;
export type MarkPublicOutput = z.infer<typeof MarkPublicOutput>;
