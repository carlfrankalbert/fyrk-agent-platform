import { z } from 'zod';

// 5-dimension scoring schema
export const CreateLeadSchema = z.object({
  // Who & what
  person_name: z.string().min(1),
  person_role: z.string().min(1),
  person_linkedin: z.string().url().optional(),
  company_name: z.string().min(1),
  company_domain: z.string().optional(),
  trigger_type: z.string().min(1),       // new_hire, promotion, reorg
  trigger_description: z.string().optional(),
  source_url: z.string().url().optional(),

  // Scoring (each dimension has its own max)
  score_fit: z.number().int().min(0).max(30).default(0),
  score_trigger: z.number().int().min(0).max(25).default(0),
  score_timing: z.number().int().min(0).max(20).default(0),
  score_authority: z.number().int().min(0).max(15).default(0),
  score_intent: z.number().int().min(0).max(10).default(0),

  // Outreach context
  why_now: z.string().optional(),
  recommended_action: z.string().optional(),
  angle: z.string().optional(),

  // Optional overrides
  status: z.enum(['new', 'planned', 'contacted', 'warm', 'cold_good_account', 'not_relevant']).default('new'),
  dedupe_key: z.string().optional(),
  account_id: z.string().uuid().optional(),
});

export type CreateLeadInput = z.input<typeof CreateLeadSchema>;

// Slack Events API schemas
export const SlackChallengeSchema = z.object({
  type: z.literal('url_verification'),
  challenge: z.string(),
  token: z.string(),
});

export const SlackReactionEvent = z.object({
  type: z.literal('reaction_added'),
  user: z.string(),
  reaction: z.string(),
  item: z.object({
    type: z.literal('message'),
    channel: z.string(),
    ts: z.string(),
  }),
  event_ts: z.string(),
});

export const SlackEventCallbackSchema = z.object({
  type: z.literal('event_callback'),
  token: z.string(),
  event: SlackReactionEvent,
});

export const SlackEventSchema = z.discriminatedUnion('type', [
  SlackChallengeSchema,
  SlackEventCallbackSchema,
]);

export type SlackEvent = z.infer<typeof SlackEventSchema>;
