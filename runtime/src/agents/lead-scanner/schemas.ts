import { z } from 'zod';

// --- Input (from n8n) ---

export const NewsArticleSchema = z.object({
  title: z.string().min(1),
  url: z.string().url(),
  summary: z.string(),
  publishedAt: z.string(),
  source: z.string(),
});

export type NewsArticle = z.infer<typeof NewsArticleSchema>;

export const LeadScannerInputSchema = z.object({
  articles: z.array(NewsArticleSchema).min(1),
  maxLeadsPerRun: z.number().int().min(1).max(50).optional(),
  scoreThreshold: z.number().int().min(0).max(100).optional(),
});

export type LeadScannerInput = z.infer<typeof LeadScannerInputSchema>;

// --- Claude response ---

export const ClaudeSignalSchema = z.object({
  person: z.object({
    name: z.string(),
    role: z.string(),
    companyName: z.string(),
    companyDomain: z.string().optional(),
  }),
  trigger: z.object({
    type: z.enum(['new_hire', 'promotion', 'reorg']),
    description: z.string(),
  }),
  scores: z.object({
    fit: z.number().int().min(0).max(30),
    trigger: z.number().int().min(0).max(25),
    timing: z.number().int().min(0).max(20),
    authority: z.number().int().min(0).max(15),
    intent: z.number().int().min(0).max(10),
  }),
  scoreReasoning: z.string(),
  outreach: z.object({
    whyNow: z.string(),
    recommendedAction: z.string(),
    angle: z.string().optional(),
  }),
  confidence: z.enum(['high', 'medium', 'low']),
  articleUrl: z.string(),
});

export type ClaudeSignal = z.infer<typeof ClaudeSignalSchema>;

export const ClaudeSignalsResponseSchema = z.object({
  signals: z.array(ClaudeSignalSchema),
  totalArticlesAnalyzed: z.number(),
});

export type ClaudeSignalsResponse = z.infer<typeof ClaudeSignalsResponseSchema>;

// --- Output ---

export const CreatedLeadSchema = z.object({
  leadId: z.string(),
  personName: z.string(),
  personRole: z.string(),
  companyName: z.string(),
  scoreTotal: z.number(),
  tier: z.string().nullable(),
  slackNotified: z.boolean(),
  dedupeKey: z.string(),
});

export type CreatedLead = z.infer<typeof CreatedLeadSchema>;

export const SkippedSignalSchema = z.object({
  personName: z.string(),
  companyName: z.string(),
  reason: z.enum(['duplicate', 'below_threshold', 'low_confidence']),
});

export type SkippedSignal = z.infer<typeof SkippedSignalSchema>;

export const UnmatchedSignalSchema = z.object({
  personName: z.string(),
  companyName: z.string(),
  scoreTotal: z.number(),
  leadId: z.string(),
});

export type UnmatchedSignal = z.infer<typeof UnmatchedSignalSchema>;

export const LeadScannerOutputSchema = z.object({
  leadsCreated: z.array(CreatedLeadSchema),
  signalsSkipped: z.array(SkippedSignalSchema),
  unmatchedSignals: z.array(UnmatchedSignalSchema),
  hasLeads: z.boolean(),
  totalArticlesAnalyzed: z.number(),
  totalSignalsDetected: z.number(),
});

export type LeadScannerOutput = z.infer<typeof LeadScannerOutputSchema>;
