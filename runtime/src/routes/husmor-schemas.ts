import { z } from 'zod';

// Slack Events API schemas for Husmor app
export const HusmorSlackChallengeSchema = z.object({
  type: z.literal('url_verification'),
  challenge: z.string(),
  token: z.string(),
});

export const HusmorSlackReactionEvent = z.object({
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

export const HusmorSlackEventCallbackSchema = z.object({
  type: z.literal('event_callback'),
  token: z.string(),
  event: HusmorSlackReactionEvent,
});

export const HusmorSlackEventSchema = z.discriminatedUnion('type', [
  HusmorSlackChallengeSchema,
  HusmorSlackEventCallbackSchema,
]);

export type HusmorSlackEvent = z.infer<typeof HusmorSlackEventSchema>;
