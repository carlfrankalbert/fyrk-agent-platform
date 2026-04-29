import { z } from 'zod';

export const CvTailorInputSchema = z.object({
  jobPosting: z.string().min(1, 'Job posting text is required'),
  roleHint: z.string().optional(),
  language: z.enum(['no', 'en']).optional(),
  additionalContext: z.string().optional(),
});

export type CvTailorInput = z.infer<typeof CvTailorInputSchema>;

const ExperienceEntrySchema = z.object({
  company: z.string(),
  role: z.string(),
  period: z.string(),
  description: z.string(),
  highlights: z.array(z.string()),
  relevanceScore: z.number().min(0).max(100),
});

const MatchAnalysisSchema = z.object({
  overallFit: z.enum(['strong', 'good', 'partial', 'weak']),
  fitScore: z.number().min(0).max(100),
  matchedSkills: z.array(z.string()),
  matchedExperience: z.array(z.string()),
  strengthNarrative: z.string(),
});

const GapAnalysisSchema = z.object({
  missingSkills: z.array(z.string()),
  missingExperience: z.array(z.string()),
  questions: z.array(z.string()),
  suggestions: z.array(z.string()),
});

export const ReviewFindingSchema = z.object({
  severity: z.enum(['high', 'medium', 'low']),
  area: z.enum(['accuracy', 'relevance', 'tone', 'language', 'clarity']),
  issue: z.string(),
  suggestion: z.string(),
});

export const ReviewerIssueSchema = z.object({
  severity: z.enum(['error', 'warning']),
  category: z.enum(['blocking', 'precision', 'language', 'match', 'sendability']),
  issue: z.string(),
  suggestion: z.string(),
  replacement: z.string().nullable().optional(),
});

export const SecondOpinionSchema = z.object({
  provider: z.literal('openai'),
  summary: z.string(),
  findings: z.array(ReviewFindingSchema),
});

export type SecondOpinion = z.infer<typeof SecondOpinionSchema>;

export const CvTailorOutputSchema = z.object({
  cv: z.object({
    name: z.string(),
    title: z.string(),
    contact: z.string(),
    profile: z.string(),
    coreCompetencies: z.array(z.string()),
    experience: z.array(ExperienceEntrySchema),
    previousExperienceSummary: z.string().nullable().optional(),
    education: z.array(z.string()),
    certifications: z.array(z.string()),
    talks: z.array(z.string()),
    languages: z.array(z.string()),
  }),
  matchAnalysis: MatchAnalysisSchema,
  gaps: GapAnalysisSchema,
  generatedAt: z.string(),
  roleHint: z.string().nullable(),
  secondOpinion: SecondOpinionSchema.optional(),
  reviewer: z.object({
    sendable: z.boolean(),
    blockingErrors: z.array(ReviewerIssueSchema),
    precisionRisks: z.array(ReviewerIssueSchema),
    languageAndProof: z.array(ReviewerIssueSchema),
    roleMatch: z.array(ReviewerIssueSchema),
    concreteChanges: z.array(z.string()),
  }).optional(),
  finalChecks: z.object({
    sendable: z.boolean(),
    blockingIssues: z.array(z.string()),
  }).optional(),
});

export type CvTailorOutput = z.infer<typeof CvTailorOutputSchema>;

export const EditorialPassSchema = z.object({
  profile: z.string(),
  coreCompetencies: z.array(z.string()),
  previousExperienceSummary: z.string().nullable().optional(),
  experience: z.array(z.object({
    description: z.string(),
    highlights: z.array(z.string()),
  })),
});

export type EditorialPass = z.infer<typeof EditorialPassSchema>;

export const ReviewerPassSchema = z.object({
  sendable: z.boolean(),
  blockingErrors: z.array(ReviewerIssueSchema),
  precisionRisks: z.array(ReviewerIssueSchema),
  languageAndProof: z.array(ReviewerIssueSchema),
  roleMatch: z.array(ReviewerIssueSchema),
  concreteChanges: z.array(z.string()),
  profile: z.string(),
  coreCompetencies: z.array(z.string()),
  previousExperienceSummary: z.string().nullable().optional(),
  experience: z.array(z.object({
    description: z.string(),
    highlights: z.array(z.string()),
  })),
});

export type ReviewerPass = z.infer<typeof ReviewerPassSchema>;

export const ReviewPassSchema = z.object({
  summary: z.string(),
  findings: z.array(ReviewFindingSchema),
  profile: z.string(),
  coreCompetencies: z.array(z.string()),
  previousExperienceSummary: z.string().nullable().optional(),
  experience: z.array(z.object({
    description: z.string(),
    highlights: z.array(z.string()),
  })),
});

export type ReviewPass = z.infer<typeof ReviewPassSchema>;

export const ReviewPassJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'findings', 'profile', 'coreCompetencies', 'previousExperienceSummary', 'experience'],
  properties: {
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'area', 'issue', 'suggestion'],
        properties: {
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          area: { type: 'string', enum: ['accuracy', 'relevance', 'tone', 'language', 'clarity'] },
          issue: { type: 'string' },
          suggestion: { type: 'string' },
        },
      },
    },
    profile: { type: 'string' },
    coreCompetencies: {
      type: 'array',
      items: { type: 'string' },
    },
    previousExperienceSummary: {
      anyOf: [
        { type: 'string' },
        { type: 'null' },
      ],
    },
    experience: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['description', 'highlights'],
        properties: {
          description: { type: 'string' },
          highlights: {
            type: 'array',
            items: { type: 'string' },
          },
        },
      },
    },
  },
} satisfies Record<string, unknown>;
