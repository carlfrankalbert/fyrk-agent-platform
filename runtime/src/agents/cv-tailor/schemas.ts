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

export const CvTailorOutputSchema = z.object({
  cv: z.object({
    name: z.string(),
    title: z.string(),
    contact: z.string(),
    profile: z.string(),
    coreCompetencies: z.array(z.string()),
    experience: z.array(ExperienceEntrySchema),
    education: z.array(z.string()),
    certifications: z.array(z.string()),
    talks: z.array(z.string()),
    languages: z.array(z.string()),
  }),
  matchAnalysis: MatchAnalysisSchema,
  gaps: GapAnalysisSchema,
  generatedAt: z.string(),
  roleHint: z.string().nullable(),
});

export type CvTailorOutput = z.infer<typeof CvTailorOutputSchema>;
