import { z } from 'zod';

export const GtmPipelineInputSchema = z.object({
  weekOverride: z.number().optional(),
});

export type GtmPipelineInput = z.infer<typeof GtmPipelineInputSchema>;

export const PivotTriggerSchema = z.object({
  id: z.string(),
  message: z.string(),
  severity: z.enum(['warning', 'critical']),
});

export type PivotTrigger = z.infer<typeof PivotTriggerSchema>;

export const GtmMetricsSchema = z.object({
  activeCalls: z.number(),
  offersSent: z.number(),
  paidDays: z.number().nullable(),
  folqInbound: z.number().nullable(),
  icpComments: z.number().nullable(),
});

export type GtmMetrics = z.infer<typeof GtmMetricsSchema>;

export const GtmPipelineOutputSchema = z.object({
  weekNumber: z.number(),
  metrics: GtmMetricsSchema,
  pivotTriggers: z.array(PivotTriggerSchema),
  slackPosted: z.boolean(),
});

export type GtmPipelineOutput = z.infer<typeof GtmPipelineOutputSchema>;

/** Lead shape as returned from Supabase query */
export interface GtmLead {
  status: string;
  created_at: string;
  score: number | null;
  company_name: string | null;
  company_size: number | null;
}
