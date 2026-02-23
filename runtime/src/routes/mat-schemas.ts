import { z } from 'zod';

// Slack Events API schemas for FYRK Mat app
export const MatSlackChallengeSchema = z.object({
  type: z.literal('url_verification'),
  challenge: z.string(),
  token: z.string(),
});

export const MatSlackReactionEvent = z.object({
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

export const MatSlackEventCallbackSchema = z.object({
  type: z.literal('event_callback'),
  token: z.string(),
  event: MatSlackReactionEvent,
});

export const MatSlackEventSchema = z.discriminatedUnion('type', [
  MatSlackChallengeSchema,
  MatSlackEventCallbackSchema,
]);

export type MatSlackEvent = z.infer<typeof MatSlackEventSchema>;
