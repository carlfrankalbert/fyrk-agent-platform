import { z } from 'zod';

export const EditorialRoomInputSchema = z.object({
  draft: z.string().min(1, 'Idé eller utkast er påkrevd'),
  mode: z.enum(['explore', 'improve', 'finalize']).optional(),
  audience: z.string().optional(),
  intent: z.string().optional(),
  format: z.enum(['post', 'comment']).optional(),
  language: z.enum(['no', 'en']).optional(),
  tier: z.enum(['quality', 'fast']).optional(),
  revisionNotes: z.string().optional(),
  previousFinalPost: z.string().optional(),
});

export type EditorialRoomInput = z.infer<typeof EditorialRoomInputSchema>;

export interface ResolvedEditorialRoomInput {
  draft: string;
  mode: 'explore' | 'improve' | 'finalize';
  audience?: string;
  intent?: string;
  format: 'post' | 'comment';
  language: 'no' | 'en';
  tier: 'quality' | 'fast';
  revisionNotes?: string;
  previousFinalPost?: string;
}

export function resolveDefaults(input: EditorialRoomInput): ResolvedEditorialRoomInput {
  return {
    draft: input.draft,
    mode: input.mode ?? 'improve',
    audience: input.audience,
    intent: input.intent,
    format: input.format ?? 'post',
    language: input.language ?? 'no',
    tier: input.tier ?? 'quality',
    revisionNotes: input.revisionNotes,
    previousFinalPost: input.previousFinalPost,
  };
}

// ─── Brief ──────────────────────────────────────────────────────────────────

export const BriefSchema = z.object({
  goal: z.string(),
  audience: z.string(),
  positioning: z.string(),
  toneTargets: z.array(z.string()),
  risks: z.array(z.string()),
});

export type Brief = z.infer<typeof BriefSchema>;

// ─── Groundwork (tillatt grunnlag) ──────────────────────────────────────────

export const GroundworkSchema = z.object({
  fromInput: z.array(z.string()),
  fromCarlContext: z.array(z.string()),
  reasonableInferences: z.array(z.string()),
  placeholders: z.array(z.string()),
});

export type Groundwork = z.infer<typeof GroundworkSchema>;

// ─── Posisjoneringsredaktør ─────────────────────────────────────────────────

export const PositioningPassSchema = z.object({
  takeaway: z.string(),
  honestAngle: z.string(),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  reframings: z.array(z.string()),
});

export type PositioningPass = z.infer<typeof PositioningPassSchema>;

// ─── Språkredaktør ──────────────────────────────────────────────────────────

export const LanguagePassSchema = z.object({
  polishedDraft: z.string(),
  cuts: z.array(z.string()),
  alternativeOpenings: z.array(z.string()),
  alternativeClosings: z.array(z.string()),
});

export type LanguagePass = z.infer<typeof LanguagePassSchema>;

// ─── Skeptiker ──────────────────────────────────────────────────────────────

export const SkepticPassSchema = z.object({
  verdict: z.enum(['send', 'revise', 'rethink']),
  genericPhrases: z.array(z.string()),
  overclaims: z.array(z.string()),
  unclearPoints: z.array(z.string()),
  needsConcretization: z.array(z.string()),
  threeSecondTest: z.string(),
});

export type SkepticPass = z.infer<typeof SkepticPassSchema>;

// ─── Faktavokter ────────────────────────────────────────────────────────────

export const ClaimClassificationSchema = z.object({
  claim: z.string(),
  classification: z.enum([
    'supported_input',
    'supported_context',
    'reasonable_interpretation',
    'unsupported',
    'should_remove',
  ]),
  action: z.enum(['keep', 'soften', 'remove']),
  softerPhrasing: z.string().nullable(),
});

export type ClaimClassification = z.infer<typeof ClaimClassificationSchema>;

export const FactGuardPassSchema = z.object({
  classifiedClaims: z.array(ClaimClassificationSchema),
  cleanedDraft: z.string(),
  removedClaims: z.array(z.string()),
  softenedClaims: z.array(z.string()),
});

export type FactGuardPass = z.infer<typeof FactGuardPassSchema>;

// ─── Sjefredaktør / Final ───────────────────────────────────────────────────

export const FinalPassSchema = z.object({
  recommendedPost: z.string(),
  // "Samme tekst, bare bedre" — korte kommentarer om hva som ble endret og hvorfor.
  // Kapasiteten på 5 håndheves i prompt + trimmes i index.ts, ikke i Zod (unngår runtime-feil).
  changeNotes: z.array(z.string()),
});

export type FinalPass = z.infer<typeof FinalPassSchema>;

// ─── Output ─────────────────────────────────────────────────────────────────

export const EditorialRoomOutputSchema = z.object({
  brief: BriefSchema,
  groundwork: GroundworkSchema,
  positioning: PositioningPassSchema,
  language: LanguagePassSchema,
  skeptic: SkepticPassSchema,
  factGuard: FactGuardPassSchema,
  final: FinalPassSchema,
  generatedAt: z.string(),
  mode: z.enum(['explore', 'improve', 'finalize']),
});

export type EditorialRoomOutput = z.infer<typeof EditorialRoomOutputSchema>;

// ─── OpenAI strict JSON schemas (used when a role runs on OpenAI) ───────────

export const BriefJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['goal', 'audience', 'positioning', 'toneTargets', 'risks'],
  properties: {
    goal: { type: 'string' },
    audience: { type: 'string' },
    positioning: { type: 'string' },
    toneTargets: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
  },
} satisfies Record<string, unknown>;

export const GroundworkJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['fromInput', 'fromCarlContext', 'reasonableInferences', 'placeholders'],
  properties: {
    fromInput: { type: 'array', items: { type: 'string' } },
    fromCarlContext: { type: 'array', items: { type: 'string' } },
    reasonableInferences: { type: 'array', items: { type: 'string' } },
    placeholders: { type: 'array', items: { type: 'string' } },
  },
} satisfies Record<string, unknown>;

export const PositioningPassJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['takeaway', 'honestAngle', 'strengths', 'weaknesses', 'reframings'],
  properties: {
    takeaway: { type: 'string' },
    honestAngle: { type: 'string' },
    strengths: { type: 'array', items: { type: 'string' } },
    weaknesses: { type: 'array', items: { type: 'string' } },
    reframings: { type: 'array', items: { type: 'string' } },
  },
} satisfies Record<string, unknown>;

export const LanguagePassJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['polishedDraft', 'cuts', 'alternativeOpenings', 'alternativeClosings'],
  properties: {
    polishedDraft: { type: 'string' },
    cuts: { type: 'array', items: { type: 'string' } },
    alternativeOpenings: { type: 'array', items: { type: 'string' } },
    alternativeClosings: { type: 'array', items: { type: 'string' } },
  },
} satisfies Record<string, unknown>;

export const SkepticPassJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'genericPhrases', 'overclaims', 'unclearPoints', 'needsConcretization', 'threeSecondTest'],
  properties: {
    verdict: { type: 'string', enum: ['send', 'revise', 'rethink'] },
    genericPhrases: { type: 'array', items: { type: 'string' } },
    overclaims: { type: 'array', items: { type: 'string' } },
    unclearPoints: { type: 'array', items: { type: 'string' } },
    needsConcretization: { type: 'array', items: { type: 'string' } },
    threeSecondTest: { type: 'string' },
  },
} satisfies Record<string, unknown>;

export const FactGuardJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['classifiedClaims', 'cleanedDraft', 'removedClaims', 'softenedClaims'],
  properties: {
    classifiedClaims: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['claim', 'classification', 'action', 'softerPhrasing'],
        properties: {
          claim: { type: 'string' },
          classification: {
            type: 'string',
            enum: [
              'supported_input',
              'supported_context',
              'reasonable_interpretation',
              'unsupported',
              'should_remove',
            ],
          },
          action: { type: 'string', enum: ['keep', 'soften', 'remove'] },
          softerPhrasing: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
          },
        },
      },
    },
    cleanedDraft: { type: 'string' },
    removedClaims: { type: 'array', items: { type: 'string' } },
    softenedClaims: { type: 'array', items: { type: 'string' } },
  },
} satisfies Record<string, unknown>;

export const FinalJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['recommendedPost', 'changeNotes'],
  properties: {
    recommendedPost: { type: 'string' },
    changeNotes: { type: 'array', items: { type: 'string' } },
  },
} satisfies Record<string, unknown>;
